import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { attachmentPath, unreferencedFiles, withFileCleanup } from "../main/storage/files";
import { KnowledgeService } from "../main/knowledge/service";
import { EditHistory } from "../main/knowledge/history";
import { PaperService } from "../main/knowledge/papers";
import { PurgeService } from "../main/knowledge/purge";
import { defaultMetadata } from "../shared/attrs/values";
import { display, search } from "../shared/attrs/format";
import { PDF_EXTRACTOR_VERSION } from "../shared/content/pdf-text";
import { type AttributeDefinition, type AttributeType, type AttributeValue } from "../shared/types/attributes";
import { knownCoordinatePdf } from "./fixtures/pdf-text";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { service: KnowledgeService; history: EditHistory; papers: PaperService; purge: PurgeService } {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "files-")));
    const service = new KnowledgeService(ws.db), history = new EditHistory(service), papers = new PaperService(service, ws.info.path), purge = new PurgeService(service, history, ws.info.path);
    t.after(() => {
 if (ws.database.open) ws.database.close();
});
    return { ...ws, service, history, papers, purge };
}
function definition(service: KnowledgeService, type: AttributeType): AttributeDefinition {
    const item = { id: "custom:" + randomUUID(), name: "A", type, metadata: defaultMetadata(type) };
    assert.equal(service.setDefinition(item.id, item, "definitions"), null);
    return item;
}
function changeType(service: KnowledgeService, item: AttributeDefinition, type: AttributeType): void {
    const next = { ...item, type }, preview = service.setDefinition(item.id, next, "definitions");
    if (preview) assert.equal(service.setDefinition(item.id, next, "definitions", preview.token), null);
}
function edit(service: KnowledgeService, pageId: string, values: Record<string, AttributeValue>, tabId = "files"): void {
    assert.equal(service.commitEdit({ pageId, tabId, batch: 0, blocks: [], attributes: values }).status, "saved");
}
function checkIndex(service: KnowledgeService): void {
    const query = "SELECT * FROM link_refs ORDER BY source_kind,source_id,source_field,target_kind,target_id";
    const before = service.statement(query).all();
    service.rebuildLinks();
    assert.deepEqual(service.statement(query).all(), before);
}
function trash(service: KnowledgeService, pageId: string): void {
    const result = service.trash([pageId], "trash");
    if (result.status === "confirmation") assert.equal(service.trash([pageId], "trash", result.preview.token).status, "saved");
}
function erase(purge: PurgeService, pageId: string): void {
    const preview = purge.purge([pageId], "purge");
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") assert.equal(purge.purge([pageId], "purge", preview.token).status, "deleted");
}

test("file properties validate existing identities, ordered distinct lists and canonical empty storage", t => {
    const { service, papers, info } = fixture(t), page = service.create("paper", "A"), single = definition(service, "file"), many = definition(service, "files");
    const a = join(info.path, "A.txt"), b = join(info.path, "B.txt");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    const files = papers.attachFiles([a, b], page.id, "paper_files", "files"), [first, second] = files.map(file => file.id);
    assert.deepEqual(service.get(page.id).attributes.paper_files, [first, second]);
    edit(service, page.id, { paper_files: [], [single.id]: first, [many.id]: [second] });
    for (const values of [{ [single.id]: randomUUID() }, { [many.id]: [first, randomUUID()] }, { [many.id]: [first, first] }, { [single.id]: [] }, { [many.id]: null }, { [single.id]: "A.txt" }]) {
        assert.throws(() => edit(service, page.id, values));
    }
    assert.deepEqual(service.get(page.id).attributes[many.id], [second]);
    edit(service, page.id, { [single.id]: null, [many.id]: [] });
    assert.equal(service.statement("SELECT value FROM page_attrs WHERE page_id=? AND attr_id=?").pluck().get(page.id, single.id), null);
    assert.equal(service.statement("SELECT value FROM page_attrs WHERE page_id=? AND attr_id=?").pluck().get(page.id, many.id), "[]");
    assert.throws(() => service.attributes.write(page.id, { [single.id]: randomUUID() }), hasFailure("attachment-missing"));
    service.attributes.write(page.id, { [single.id]: first });
    checkIndex(service);
});

test("file type conversions preserve order, choose the first item, and discard strings that resemble identities", t => {
    const { service, papers, info } = fixture(t), page = service.create("paper", "A"), item = definition(service, "file"), text = definition(service, "string");
    const a = join(info.path, "A.txt"), b = join(info.path, "B.txt");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    const [first, second] = papers.attachFiles([a, b], page.id, "paper_files").map(file => file.id);
    edit(service, page.id, { paper_files: [], [item.id]: first, [text.id]: first });
    changeType(service, item, "files");
    assert.deepEqual(service.get(page.id).attributes[item.id], [first]); checkIndex(service);
    edit(service, page.id, { [item.id]: [second, first] });
    changeType(service, { ...item, type: "files" }, "file");
    assert.equal(service.get(page.id).attributes[item.id], second); checkIndex(service);
    changeType(service, text, "file");
    assert.equal(service.get(page.id).attributes[text.id], null);
    changeType(service, { ...text, type: "file" }, "files");
    assert.deepEqual(service.get(page.id).attributes[text.id], []);
    changeType(service, { ...text, type: "files" }, "file");
    assert.equal(service.get(page.id).attributes[text.id], null); checkIndex(service);
    const other = definition(service, "string");
    edit(service, page.id, { [other.id]: JSON.stringify([first]) });
    changeType(service, other, "files");
    assert.deepEqual(service.get(page.id).attributes[other.id], []);
});

test("paper and custom file imports, removals, clears, undo and redo keep the reference index rebuildable", t => {
    const { service, papers, history, info } = fixture(t), page = service.create("paper", "A"), item = definition(service, "files"), single = definition(service, "file");
    const a = join(info.path, "A.txt"), b = join(info.path, "B.txt");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    const files = papers.attachFiles([a, b], page.id, "paper_files", "files"), [first, second] = files.map(file => file.id);
    checkIndex(service);
    assert.equal(history.apply("files", "undo").status, "saved");
    assert.deepEqual(service.get(page.id).attributes.paper_files, []); checkIndex(service);
    assert.equal(papers.files().length, 2, "undoing import keeps immutable bytes available for redo");
    assert.equal(history.apply("files", "redo").status, "saved"); checkIndex(service);
    const custom = papers.attachFiles([b, a, b], page.id, item.id, "files").map(file => file.id);
    assert.equal(new Set(custom).size, 3);
    assert.ok(custom.every(id => ![first, second].includes(id)));
    assert.deepEqual(service.get(page.id).attributes[item.id], custom); checkIndex(service);
    edit(service, page.id, { paper_files: [first], [item.id]: [] }); checkIndex(service);
    assert.equal(history.apply("files", "undo").status, "saved"); checkIndex(service);
    assert.deepEqual(service.get(page.id).attributes[item.id], custom);
    assert.equal(history.apply("files", "redo").status, "saved"); checkIndex(service);
    const [before] = papers.attachFiles([a], page.id, single.id, "files");
    const [after] = papers.attachFiles([b], page.id, single.id, "files"); checkIndex(service);
    assert.notEqual(before.id, after.id);
    assert.equal(service.get(page.id).attributes[single.id], after.id);
    assert.equal(history.apply("files", "undo").status, "saved");
    assert.equal(service.get(page.id).attributes[single.id], before.id); checkIndex(service);
    assert.equal(service.commitEdit({ pageId: page.id, tabId: "files", batch: 0, blocks: [], detach: [single.id] }).status, "saved"); checkIndex(service);
    assert.equal(history.apply("files", "undo").status, "saved"); checkIndex(service);
    const preview = service.setDefinition(item.id, null, "definitions");
    if (preview) assert.equal(service.setDefinition(item.id, null, "definitions", preview.token), null);
    checkIndex(service);
});

test("arbitrary attachments retain their suffix and names while PDF operations reject other media", async t => {
    const { service, papers, info } = fixture(t), page = service.create("paper", "A"), item = definition(service, "file");
    const csv = join(info.path, "补充数据.CSV"), pdf = join(info.path, "正文.pdf");
    writeFileSync(csv, "a,b\n1,2"); writeFileSync(pdf, knownCoordinatePdf());
    const [data, document] = papers.attachFiles([csv, pdf], page.id, "paper_files", "files");
    assert.equal(data.mediaType, "text/csv"); assert.equal(document.mediaType, "application/pdf");
    const stored = service.statement("SELECT stored_name FROM attachments WHERE id=?").pluck().get(data.id) as string;
    assert.equal(extname(stored), ".CSV");
    assert.deepEqual(Buffer.from(papers.read(data.id)), readFileSync(csv));
    assert.equal(papers.externalPath(data.id), join(info.path, "attachments", stored));
    assert.deepEqual((await papers.resources(page.id)).files.map(file => file.id), [data.id, document.id]);
    assert.equal(papers.hasPDF(page.id), true);
    assert.throws(() => papers.position(page.id, data.id, { page: 1, scale: "auto", rotation: 0, left: 0, top: 0 }), hasFailure("paper-invalid-position"));
    await assert.rejects(papers.unlockPDF(data.id, ""), hasFailure("attachment-pdf-required"));
    await assert.rejects(papers.annotate(page.id, { fileId: data.id, pageNumber: 1, rectangles: [{ x: 1, y: 1, width: 1, height: 1 }], quote: "", context: "", extractorVersion: PDF_EXTRACTOR_VERSION }, "annotations", "yellow"), hasFailure("attachment-pdf-required"));
    edit(service, page.id, { [item.id]: data.id, paper_files: [] });
    assert.equal(papers.hasPDF(page.id), false);
    const context = { fileName: (id: string): string | undefined => papers.files([id])[0]?.originalName };
    const multiple = service.attributes.definition("paper_files");
    assert.equal(display(item, data.id, context), "补充数据.CSV");
    assert.equal(search(multiple, [data.id, document.id], context), "补充数据.CSV、正文.pdf");
    assert.deepEqual(service.list({ keyword: "补充数据" }).items.map(row => row.id), [page.id]);
    assert.equal(service.list({ keyword: data.id }).total, 0);
    edit(service, page.id, { [item.id]: null });
    assert.equal(service.list({ keyword: "补充数据" }).total, 0); checkIndex(service);
    for (const name of ["../A.pdf", "A/../../B.pdf", "A\\B.txt", "A.txt:stream", "A.", "A.txt "]) assert.throws(() => attachmentPath(info.path, name), hasFailure("attachment-invalid-name"));
});

test("clearing an attachment leaves bytes available for undo, but reopening removes unreferenced files", async t => {
    const { service, papers, history, info, database } = fixture(t), path = join(info.path, "A.pdf");
    writeFileSync(path, knownCoordinatePdf());
    const pageId = papers.importFile(path, undefined, "files").pageId, file = papers.files()[0];
    const stored = papers.externalPath(file.id);
    edit(service, pageId, { paper_files: [] });
    assert.equal(existsSync(stored), true);
    assert.deepEqual(unreferencedFiles(service.db).map(row => row.id), [file.id]);
    assert.equal(history.apply("files", "undo").status, "saved");
    assert.deepEqual(unreferencedFiles(service.db), []);
    edit(service, pageId, { paper_files: [] });
    database.close();
    const reopened = openWorkspace(info.path);
    t.after(() => reopened.database.close());
    assert.equal(existsSync(stored), false);
    for (const table of ["attachments"]) assert.equal(reopened.database.prepare("SELECT count(*) FROM " + table).pluck().get(), 0);
    assert.deepEqual(new EditHistory(new KnowledgeService(reopened.db)).state("files"), { canUndo: false, redo: [] });
});

test("a recycled page's custom property protects its independently imported file until the page is permanently deleted", async t => {
    const { service, papers, purge, info, database } = fixture(t), path = join(info.path, "A.pdf"), item = definition(service, "file");
    writeFileSync(path, knownCoordinatePdf());
    const paperId = papers.importFile(path).pageId, file = papers.files()[0], other = service.create("editable", "B");
    const [owned] = papers.attachFiles([path], other.id, item.id, "other");
    await papers.annotate(paperId, { fileId: file.id, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "", context: "", extractorVersion: PDF_EXTRACTOR_VERSION }, "annotations", "yellow");
    const stored = papers.externalPath(owned.id), original = papers.externalPath(file.id);
    trash(service, paperId); trash(service, other.id);
    erase(purge, paperId);
    assert.equal(existsSync(original), false);
    assert.equal(existsSync(stored), true); assert.deepEqual(unreferencedFiles(service.db), []);
    database.close();
    const reopened = openWorkspace(info.path);
    t.after(() => reopened.database.close());
    assert.equal(existsSync(stored), true, "opening retains references from recycled pages too");
    const next = new KnowledgeService(reopened.db), history = new EditHistory(next), cleanup = new PurgeService(next, history, info.path);
    erase(cleanup, other.id);
    assert.equal(existsSync(stored), false);
    assert.equal(new PaperService(next, info.path).hasPDF(paperId), false, "dangling subscription paper IDs still report no PDF after purge");
    for (const table of ["attachments"]) assert.equal(next.statement("SELECT count(*) FROM " + table).pluck().get(), 0);
});

test("failed batch import and failed orphan cleanup restore rows, bytes and history", t => {
    const { service, papers, history, info } = fixture(t), page = service.create("paper", "A"), a = join(info.path, "A.txt"), b = join(info.path, "B.txt");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    assert.throws(() => papers.attachFiles([a, join(info.path, "missing.txt")], page.id, "paper_files", "files"));
    assert.deepEqual(papers.files(), []); assert.deepEqual(service.get(page.id).attributes.paper_files, []);
    assert.equal(history.state("files").canUndo, false);
    const [first, second] = papers.attachFiles([a, b], page.id, "paper_files", "files");
    const paths = papers.files().map(file => papers.externalPath(file.id));
    edit(service, page.id, { paper_files: [] });
    const before = history.state("files");
    service.statement("UPDATE attachments SET stored_name='../invalid.txt' WHERE id=?").run(second.id);
    assert.throws(() => withFileCleanup(service.db, info.path, cleanup => cleanup()), hasFailure("attachment-invalid-name"));
    assert.equal(papers.files().length, 2);
    for (const path of paths) assert.equal(existsSync(path), true);
    assert.deepEqual(Buffer.from(papers.read(first.id)), readFileSync(a));
    assert.deepEqual(history.state("files"), before);
});

test("file ownership rejects other pages, other attributes and recycled owners, while one atomic move remains reversible", t => {
    const { service, papers, history, info } = fixture(t), first = service.create("paper", "A"), second = service.create("paper", "B"), single = definition(service, "file"), many = definition(service, "files");
    const path = join(info.path, "A.txt"); writeFileSync(path, "A");
    const [file] = papers.attachFiles([path], first.id, "paper_files", "files");
    const duplicate = (): void => edit(service, second.id, { [single.id]: file.id });
    assert.throws(duplicate, /attachment-owned/);
    assert.throws(() => edit(service, first.id, { [single.id]: file.id }), /attachment-owned/);
    assert.throws(() => edit(service, first.id, { paper_files: [], [single.id]: file.id, [many.id]: [file.id] }), /attachment-owned/);
    assert.throws(() => service.attributes.write(second.id, { [single.id]: file.id }), /attachment-owned/);
    assert.throws(() => service.create("editable", "C", { [single.id]: file.id }), /attachment-owned/);
    edit(service, first.id, { paper_files: [], [single.id]: file.id });
    checkIndex(service);
    assert.equal(history.apply("files", "undo").status, "saved");
    assert.deepEqual(service.get(first.id).attributes.paper_files, [file.id]);
    assert.equal(history.apply("files", "redo").status, "saved");
    assert.equal(service.get(first.id).attributes[single.id], file.id);
    trash(service, first.id);
    assert.throws(duplicate, /attachment-owned/);
    checkIndex(service);
});