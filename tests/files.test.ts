import { pageHistory, workspaceHistory } from "./support/history";
import * as commit from "../main/knowledge/commit";
import { knowledgeServices, historyServices, paperServices, purgeServices, session, type Knowledge, type History, type Papers, type Purge } from "./support/session";
import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openTest, openWorkspace } from "./support/session";
import * as attachments from "../main/attachments/service";
import { readAttachment } from "../main/attachments/read";
import { attachmentPath } from "../main/storage/files";
import { defaultMetadata } from "../shared/attrs/values";
import { display, search } from "../shared/attrs/format";
import { payload } from "../shared/content/blocks";
import { attachmentURL } from "../shared/content/media";
import { PDF_EXTRACTOR_VERSION } from "../shared/content/pdf-text";
import { type AttributeDefinition, type AttributeType, type AttributeValue } from "../shared/types/attributes";
import type { ContentBlock } from "../shared/types/content";
import { knownCoordinatePdf } from "./fixtures/pdf-text";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { service: Knowledge; history: History; papers: Papers; purge: Purge } {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "files-")));
    const service = knowledgeServices(), history = historyServices(), papers = paperServices(), purge = purgeServices();
    t.after(() => {
        session.close();
    });
    return { ...ws, service, history, papers, purge };
}
function definition(service: Knowledge, type: AttributeType): AttributeDefinition {
    const item = { id: "custom:" + randomUUID(), name: "A", type, metadata: defaultMetadata(type) };
    assert.equal(service.setDefinition(item.id, item), null);
    return item;
}
function changeType(service: Knowledge, item: AttributeDefinition, type: AttributeType): void {
    const next = { ...item, type }, preview = service.setDefinition(item.id, next);
    if (preview) assert.equal(service.setDefinition(item.id, next, preview.token), null);
}
function edit(service: Knowledge, pageId: string, values: Record<string, AttributeValue>): void {
    assert.equal(service.commitEdit({ pageId, batch: 0, blocks: [], attributes: values }, pageHistory(pageId)).status, "saved");
}
function checkIndex(service: Knowledge): void {
    const query = "SELECT * FROM link_refs ORDER BY source_kind,source_id,source_field,target_kind,target_id";
    const before = service.statement(query).all();
    service.rebuildLinks();
    assert.deepEqual(service.statement(query).all(), before);
}
function trash(service: Knowledge, pageId: string): void {
    const result = service.trash([pageId], workspaceHistory);
    if (result.status === "confirmation") assert.equal(service.trash([pageId], workspaceHistory, result.preview.token).status, "saved");
}
function erase(purge: Purge, pageId: string): void {
    const preview = purge.purge([pageId]);
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") assert.equal(purge.purge([pageId], preview.token).status, "deleted");
}

test("file properties validate existing identities, ordered distinct lists and canonical empty storage", async t => {
    const { service, papers, info } = fixture(t), page = service.create("paper", "A"), single = definition(service, "file"), many = definition(service, "files");
    const a = join(info.path, "A.txt"), b = join(info.path, "B.txt");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    const files = await papers.attachFiles([a, b], page.id, "paper_files", pageHistory(page.id)), [first, second] = files.map(file => file.id);
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

test("file type conversions preserve order, choose the first item, and discard strings that resemble identities", async t => {
    const { service, papers, info } = fixture(t), page = service.create("paper", "A"), item = definition(service, "file"), text = definition(service, "string");
    const a = join(info.path, "A.txt"), b = join(info.path, "B.txt");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    const [first, second] = (await papers.attachFiles([a, b], page.id, "paper_files")).map(file => file.id);
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

test("paper and custom file imports, removals, clears, undo and redo keep the reference index rebuildable", async t => {
    const { service, papers, history, info } = fixture(t), page = service.create("paper", "A"), item = definition(service, "files"), single = definition(service, "file");
    const a = join(info.path, "A.txt"), b = join(info.path, "B.txt");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    const files = await papers.attachFiles([a, b], page.id, "paper_files", pageHistory(page.id)), [first, second] = files.map(file => file.id);
    checkIndex(service);
    assert.equal(history.apply(pageHistory(page.id), "undo").status, "saved");
    assert.deepEqual(service.get(page.id).attributes.paper_files, []); checkIndex(service);
    assert.equal(papers.files().length, 2, "undoing import keeps immutable bytes available for redo");
    assert.equal(history.apply(pageHistory(page.id), "redo").status, "saved"); checkIndex(service);
    const custom = (await papers.attachFiles([b, a, b], page.id, item.id, pageHistory(page.id))).map(file => file.id);
    assert.equal(new Set(custom).size, 3);
    assert.ok(custom.every(id => ![first, second].includes(id)));
    assert.deepEqual(service.get(page.id).attributes[item.id], custom); checkIndex(service);
    edit(service, page.id, { paper_files: [first], [item.id]: [] }); checkIndex(service);
    assert.equal(history.apply(pageHistory(page.id), "undo").status, "saved"); checkIndex(service);
    assert.deepEqual(service.get(page.id).attributes[item.id], custom);
    assert.equal(history.apply(pageHistory(page.id), "redo").status, "saved"); checkIndex(service);
    const [before] = await papers.attachFiles([a], page.id, single.id, pageHistory(page.id));
    const [after] = await papers.attachFiles([b], page.id, single.id, pageHistory(page.id)); checkIndex(service);
    assert.notEqual(before.id, after.id);
    assert.equal(service.get(page.id).attributes[single.id], after.id);
    assert.equal(history.apply(pageHistory(page.id), "undo").status, "saved");
    assert.equal(service.get(page.id).attributes[single.id], before.id); checkIndex(service);
    assert.equal(service.commitEdit({ pageId: page.id, batch: 0, blocks: [], detach: [single.id] }, pageHistory(page.id)).status, "saved"); checkIndex(service);
    assert.equal(history.apply(pageHistory(page.id), "undo").status, "saved"); checkIndex(service);
    const preview = service.setDefinition(item.id, null);
    if (preview) assert.equal(service.setDefinition(item.id, null, preview.token), null);
    checkIndex(service);
});

test("arbitrary attachments retain their suffix and names while PDF operations reject other media", async t => {
    const { service, papers, info } = fixture(t), page = service.create("paper", "A"), item = definition(service, "file");
    const csv = join(info.path, "补充数据.CSV"), pdf = join(info.path, "正文.pdf");
    writeFileSync(csv, "a,b\n1,2"); writeFileSync(pdf, knownCoordinatePdf());
    const [data, document] = await papers.attachFiles([csv, pdf], page.id, "paper_files", pageHistory(page.id));
    assert.equal(data.mediaType, "text/csv"); assert.equal(document.mediaType, "application/pdf");
    const stored = service.statement("SELECT stored_name FROM attachments WHERE id=?").pluck().get(data.id) as string;
    assert.equal(extname(stored), ".CSV");
    assert.deepEqual(Buffer.from(papers.read(data.id)), readFileSync(csv));
    assert.equal(papers.externalPath(data.id), join(info.path, "attachments", stored));
    assert.deepEqual((await papers.resources(page.id)).files.map(file => file.id), [data.id, document.id]);
    assert.equal(papers.hasPDF(page.id), true);
    assert.throws(() => papers.position(page.id, data.id, { page: 1, scale: "auto", rotation: 0, left: 0, top: 0 }), hasFailure("paper-invalid-position"));
    await assert.rejects(papers.unlockPDF(data.id, ""), hasFailure("attachment-pdf-required"));
    await assert.rejects(papers.annotate(page.id, { fileId: data.id, pageNumber: 1, rectangles: [{ x: 1, y: 1, width: 1, height: 1 }], quote: "", context: "", extractorVersion: PDF_EXTRACTOR_VERSION }, pageHistory(page.id), "yellow"), hasFailure("attachment-pdf-required"));
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
    const pageId = (await papers.importFile(path, undefined, workspaceHistory)).pageId, file = papers.files()[0];
    const stored = papers.externalPath(file.id);
    edit(service, pageId, { paper_files: [] });
    assert.equal(existsSync(stored), true);
    assert.deepEqual(attachments.unreferencedFiles(service.db).map(row => row.id), [file.id]);
    assert.equal(history.apply(pageHistory(pageId), "undo").status, "saved");
    assert.deepEqual(attachments.unreferencedFiles(service.db), []);
    edit(service, pageId, { paper_files: [] });
    session.close();
    const reopened = openWorkspace(info.path);
    t.after(() => session.close());
    assert.equal(existsSync(stored), false);
    for (const table of ["attachments"]) assert.equal(reopened.database.prepare("SELECT count(*) FROM " + table).pluck().get(), 0);
    assert.deepEqual(historyServices().state(pageHistory(pageId)), { canUndo: false, canRedo: false });
});

test("a recycled page's custom property protects its independently imported file until the page is permanently deleted", async t => {
    const { service, papers, purge, info, database } = fixture(t), path = join(info.path, "A.pdf"), item = definition(service, "file");
    writeFileSync(path, knownCoordinatePdf());
    const paperId = (await papers.importFile(path)).pageId, file = papers.files()[0], other = service.create("editable", "B");
    const [owned] = await papers.attachFiles([path], other.id, item.id, pageHistory(other.id));
    await papers.annotate(paperId, { fileId: file.id, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "", context: "", extractorVersion: PDF_EXTRACTOR_VERSION }, pageHistory(paperId), "yellow");
    const stored = papers.externalPath(owned.id), original = papers.externalPath(file.id);
    trash(service, paperId); trash(service, other.id);
    erase(purge, paperId);
    assert.equal(existsSync(original), false);
    assert.equal(existsSync(stored), true); assert.deepEqual(attachments.unreferencedFiles(service.db), []);
    session.close();
    const reopened = openWorkspace(info.path);
    t.after(() => session.close());
    assert.equal(existsSync(stored), true, "opening retains references from recycled pages too");
    const next = knowledgeServices(), history = historyServices(), cleanup = purgeServices();
    erase(cleanup, other.id);
    assert.equal(existsSync(stored), false);
    assert.equal(paperServices().hasPDF(paperId), false, "dangling subscription paper IDs still report no PDF after purge");
    for (const table of ["attachments"]) assert.equal(next.statement("SELECT count(*) FROM " + table).pluck().get(), 0);
});

test("failed batch import and failed orphan cleanup restore rows, bytes and history", async t => {
    const { service, papers, history, info } = fixture(t), page = service.create("paper", "A"), a = join(info.path, "A.txt"), b = join(info.path, "B.txt");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    await assert.rejects(() => papers.attachFiles([a, join(info.path, "missing.txt")], page.id, "paper_files", pageHistory(page.id)));
    assert.deepEqual(papers.files(), []); assert.deepEqual(service.get(page.id).attributes.paper_files, []);
    assert.equal(history.state(pageHistory(page.id)).canUndo, false);
    const [first, second] = await papers.attachFiles([a, b], page.id, "paper_files", pageHistory(page.id));
    const paths = papers.files().map(file => papers.externalPath(file.id));
    edit(service, page.id, { paper_files: [] });
    const before = history.state(pageHistory(page.id));
    service.statement("UPDATE attachments SET stored_name='../invalid.txt' WHERE id=?").run(second.id);
    assert.throws(() => commit.run({ cleanup: true }, context => context.cleanup()), hasFailure("attachment-invalid-name"));
    assert.equal(papers.files().length, 2);
    for (const path of paths) assert.equal(existsSync(path), true);
    assert.deepEqual(Buffer.from(papers.read(first.id)), readFileSync(a));
    assert.deepEqual(history.state(pageHistory(page.id)), before);
});

test("file properties share immutable files across attributes and pages, including recycled pages", async t => {
    const { service, papers, history, info } = fixture(t), first = service.create("paper", "A"), second = service.create("paper", "B"), single = definition(service, "file"), many = definition(service, "files");
    const path = join(info.path, "A.txt"); writeFileSync(path, "A");
    const [file] = await papers.attachFiles([path], first.id, "paper_files", pageHistory(first.id));
    service.attributes.write(second.id, { [single.id]: file.id });
    const third = service.create("editable", "C", { [single.id]: file.id });
    edit(service, first.id, { paper_files: [], [single.id]: file.id, [many.id]: [file.id] });
    checkIndex(service);
    assert.equal(history.apply(pageHistory(first.id), "undo").status, "saved");
    assert.deepEqual(service.get(first.id).attributes.paper_files, [file.id]);
    assert.equal(history.apply(pageHistory(first.id), "redo").status, "saved");
    assert.equal(service.get(first.id).attributes[single.id], file.id);
    trash(service, first.id);
    assert.equal(service.get(second.id).attributes[single.id], file.id);
    assert.equal(service.get(third.id).attributes[single.id], file.id);
    checkIndex(service);
});

function mediaBlock(service: Knowledge, pageId: string, fileId: string): void {
    const id = service.get(pageId).children[0];
    const block: ContentBlock = {
        id, type: "file", children: [], payload: { ...payload("file", "A caption"), media: { fileId } }
    };
    assert.equal(service.commitEdit({ pageId, batch: 0, blocks: [block] }, pageHistory(pageId)).status, "saved");
}

test("a media block validates its file, indexes the file reference, and searches captions and original names", async t => {
    const { service, papers, purge, info } = fixture(t);
    const page = service.create("editable", "Media"), paper = service.create("paper", "Paper");
    assert.throws(() => mediaBlock(service, page.id, randomUUID()), hasFailure("attachment-missing"));
    const path = join(info.path, "Lab notes.csv");
    writeFileSync(path, "A");
    const [file] = await papers.attachFiles([path], paper.id, "paper_files", pageHistory(paper.id));
    mediaBlock(service, page.id, file.id);
    assert.deepEqual(service.searchPages("caption").items.find(row => row.id === page.id)?.match, { field: "body", snippet: "A caption" });
    assert.deepEqual(service.searchPages("lab notes").items.find(row => row.id === page.id)?.match, { field: "body", snippet: file.originalName });
    checkIndex(service);
    edit(service, paper.id, { paper_files: [] });
    const stored = papers.externalPath(file.id);
    assert.equal(purge.purge(null).status, "deleted");
    assert.equal(existsSync(stored), true);
    trash(service, page.id);
    session.close();
    openWorkspace(info.path);
    assert.equal(existsSync(stored), true);
    erase(purgeServices(), page.id);
    assert.equal(existsSync(stored), false);
});

test("an orphaned media block keeps its file for undo until collection, and a remaining property keeps the file", async t => {
    const { service, papers, purge, info, history } = fixture(t);
    const page = service.create("editable", "Media"), paper = service.create("paper", "Paper");
    const path = join(info.path, "A.txt");
    writeFileSync(path, "A");
    const [file, prop] = await papers.attachFiles([path, path], paper.id, "paper_files", pageHistory(paper.id));
    edit(service, paper.id, { paper_files: [prop.id] });
    mediaBlock(service, page.id, file.id);
    const remove = (): void => assert.equal(service.commitEdit({ pageId: page.id, batch: 0, blocks: [], pageChildren: [] }, pageHistory(page.id)).status, "saved");
    remove();
    const stored = papers.externalPath(file.id);
    assert.equal(existsSync(stored), true);
    assert.equal(history.apply(pageHistory(page.id), "undo").status, "saved");
    assert.equal(service.get(page.id).blocks[page.children[0]].payload.media?.fileId, file.id);
    remove();
    assert.equal(purge.purge(null).status, "deleted");
    assert.equal(existsSync(stored), false);
    assert.equal(history.state(pageHistory(page.id)).canUndo, false);
    const reopen = service.create("editable", "Reopen");
    mediaBlock(service, reopen.id, prop.id);
    assert.equal(service.commitEdit({ pageId: reopen.id, batch: 0, blocks: [], pageChildren: [] }, pageHistory(reopen.id)).status, "saved");
    const propertyFile = papers.externalPath(prop.id);
    assert.equal(purge.purge(null).status, "deleted");
    assert.equal(existsSync(propertyFile), true);
    const another = service.create("editable", "Reopen again");
    mediaBlock(service, another.id, prop.id);
    assert.equal(service.commitEdit({ pageId: another.id, batch: 0, blocks: [], pageChildren: [] }, pageHistory(another.id)).status, "saved");
    edit(service, paper.id, { paper_files: [] });
    session.close();
    openWorkspace(info.path);
    assert.equal(existsSync(propertyFile), false);
});

test("downloaded bytes survive in-session cleanup until attached and abandoned handoffs expire on reopen", async t => {
    const ws = openTest(t, { fetchAttachment: async () => new Response(Buffer.from(knownCoordinatePdf())) });
    const service = knowledgeServices(), papers = paperServices();
    const custom = definition(service, "file");
    const page = service.create("editable", "File handoff");
    const kept = await attachments.download("https://example.org/kept.pdf", { expectedType: "application/pdf" }), abandoned = await attachments.download("https://example.org/abandoned.pdf", { expectedType: "application/pdf" });
    assert.ok(kept && abandoned);
    const path = (id: string): string => attachmentPath(ws.info.path, id + ".pdf");
    const collected = (): void => {
        assert.equal(purgeServices().purge(null).status, "deleted");
    };
    collected();
    assert.deepEqual(papers.files([kept, abandoned]).map(file => file.id).sort(), [kept, abandoned].sort());
    assert.ok(existsSync(path(kept)) && existsSync(path(abandoned)));
    assert.throws(() => commit.run({ history: false }, () => {
        edit(service, page.id, { [custom.id]: kept });
        throw new Error("rollback reference");
    }), /rollback reference/);
    collected();
    assert.ok(existsSync(path(kept)));
    edit(service, page.id, { [custom.id]: kept });
    collected();
    assert.ok(existsSync(path(kept)));
    edit(service, page.id, { [custom.id]: null });
    collected();
    assert.equal(existsSync(path(kept)), false);
    assert.ok(existsSync(path(abandoned)));
    const interrupted = join(ws.info.path, "attachments", ".download-" + randomUUID() + ".part");
    const unrelated = join(ws.info.path, "attachments", "keep.part");
    writeFileSync(interrupted, "incomplete");
    writeFileSync(unrelated, "other file");
    session.close();
    openWorkspace(ws.info.path);
    assert.equal(existsSync(interrupted), false);
    assert.equal(existsSync(unrelated), true);
    assert.deepEqual(paperServices().files([abandoned]), []);
    assert.equal(existsSync(path(abandoned)), false);
});

test("a committed media block releases the attachment handoff protection", async t => {
    const { info } = openTest(t, { fetchAttachment: async () => new Response("A", { headers: { "content-type": "text/plain" } }) });
    const service = knowledgeServices(), page = service.create("editable", "Media");
    const fileId = await attachments.download("https://example.org/A.txt");
    assert.ok(fileId);
    assert.equal(purgeServices().purge(null).status, "deleted");
    const path = attachmentPath(info.path, fileId + ".txt");
    assert.equal(existsSync(path), true);
    mediaBlock(service, page.id, fileId);
    assert.equal(service.commitEdit({ pageId: page.id, batch: 0, blocks: [], pageChildren: [] }, pageHistory(page.id)).status, "saved");
    assert.equal(purgeServices().purge(null).status, "deleted");
    assert.equal(existsSync(path), false);
});

test("the media protocol streams requested file ranges and rejects unmanaged paths", async t => {
    const { service, papers, info } = fixture(t);
    const page = service.create("paper", "A"), path = join(info.path, "A.svg");
    const bytes = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>throw \"unexpected\"</script></svg>";
    writeFileSync(path, bytes);
    const [file] = await papers.attachFiles([path], page.id, "paper_files", pageHistory(page.id));
    const url = attachmentURL(file.id);
    const request = (range: string): Promise<Response> => readAttachment(new Request(url, { headers: { range } }));
    const partial = await request("bytes=4-18");
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-type"), "image/svg+xml");
    assert.match(partial.headers.get("content-security-policy")!, /sandbox/);
    assert.equal(partial.headers.get("content-range"), `bytes 4-18/${bytes.length}`);
    assert.equal(await partial.text(), bytes.slice(4, 19));
    assert.equal(await (await request("bytes=-5")).text(), bytes.slice(-5));
    const invalid = await request("bytes=9999-");
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */" + bytes.length);
    const head = await readAttachment(new Request(url, { method: "HEAD" }));
    assert.equal(head.headers.get("content-length"), String(bytes.length));
    assert.equal(head.body, null);
    assert.equal(await (await readAttachment(new Request(url))).text(), bytes);
    for (const address of [attachmentURL(randomUUID()), attachmentURL("../" + file.id), url + "?path=A.svg", "file://" + path]) {
        // Standard URL parsers can remove literal dot segments before a handler sees the address.
        if (new URL(address).href !== url) assert.equal((await readAttachment(new Request(address))).status, 404);
    }
    session.close();
    assert.equal((await readAttachment(new Request(url))).status, 404);
});

test("a dropped PDF and its retaining block have one reversible history entry", async t => {
    const { service, history, info } = fixture(t), page = service.create("editable", "Drop target");
    const path = join(info.path, "Source.pdf");
    writeFileSync(path, knownCoordinatePdf());
    const file = await attachments.importPath(path), paperId = randomUUID(), id = randomUUID(), source = pageHistory(page.id);
    const preview: ContentBlock = {
        id, type: "blocked_reference", children: [], payload: { ...payload("blocked_reference"), target: { kind: "page", id: paperId } }
    };
    const linkedPapers = [{ id: paperId, fileId: file.id }];
    assert.throws(() => service.commitEdit({ pageId: page.id, batch: 0, blocks: [], linkedPapers }, source), hasFailure("page-invalid-create"));
    assert.equal(service.list({ kind: "paper" }).total, 0);
    const insertion = { pageId: page.id, batch: 0, blocks: [preview], pageChildren: [id, ...page.children], linkedPapers };
    assert.equal(service.commitEdit(insertion, source).status, "saved");
    assert.equal(service.get(paperId).title, "Source");
    assert.equal(service.flags(paperId).independent, false);
    assert.deepEqual(service.get(paperId).attributes.paper_files, [file.id]);
    assert.deepEqual(service.get(page.id).children, insertion.pageChildren);
    assert.equal(history.apply(source, "undo").status, "saved");
    assert.equal(history.state(source).canUndo, false);
    assert.deepEqual(service.get(page.id).children, page.children);
    assert.equal(service.flags(paperId).deleted, true);
    assert.equal(history.apply(source, "redo").status, "saved");
    assert.equal(service.flags(paperId).deleted, false);
    assert.equal(service.get(page.id).children[0], id);
    const deletion = { pageId: page.id, batch: 0, blocks: [], pageChildren: page.children };
    const review = service.commitEdit(deletion, source);
    assert.equal(review.status, "confirmation");
    if (review.status !== "confirmation") return;
    assert.deepEqual(review.preview.recycled.map(item => item.id), [paperId]);
    assert.equal(service.commitEdit(deletion, source, review.preview.token).status, "saved");
    assert.equal(service.flags(paperId).deleted, true);
    assert.equal(existsSync(file.path), true);
});

test("save as streams immutable bytes to the chosen name and cancellation leaves no output", async t => {
    const { info } = fixture(t), source = join(info.path, "A.txt"), output = join(info.path, "Saved.txt"), bytes = "media data";
    writeFileSync(source, bytes);
    const file = await attachments.importPath(source);
    await attachments.saveAs(file.id, async name => {
        assert.equal(name, "A.txt");
        return undefined;
    });
    assert.equal(existsSync(output), false);
    await attachments.saveAs(file.id, async () => output);
    assert.equal(readFileSync(output, "utf8"), bytes);
    assert.equal(readFileSync(file.path, "utf8"), bytes);
    await assert.rejects(attachments.saveAs(file.id, async () => file.path), hasFailure("attachment-save-directory"));
});