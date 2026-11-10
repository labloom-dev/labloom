import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { PaperService } from "../main/knowledge/papers";
import { EditHistory } from "../main/knowledge/history";
import { rectanglePoints, rectangleWithinPage } from "../shared/content/anchors";
import { PDF_EXTRACTOR_VERSION } from "../shared/content/pdf-text";
import { payload } from "../shared/content/blocks";
import { type AnchorInput } from "../shared/types/papers";
import { knownCoordinatePdf } from "./fixtures/pdf-text";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { knowledge: KnowledgeService; papers: PaperService } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "paper-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const knowledge = new KnowledgeService(workspace.db), papers = new PaperService(knowledge, workspace.info.path);
    return { ...workspace, knowledge, papers };
}
function importPDF(papers: PaperService, path: string): string {
    writeFileSync(path, knownCoordinatePdf());
    return papers.importFile(path).pageId;
}
function selection(fileId: string): AnchorInput {
    return { fileId, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "Untrusted client quotation", context: "Context", extractorVersion: PDF_EXTRACTOR_VERSION };
}

test("managed attachments preserve identity and reject replaced bytes; identical import opens its existing paper", async t => {
    const { knowledge, papers, info, database } = fixture(t);
    const path = join(info.path, "original.pdf"), id = importPDF(papers, path);
    const files = (await papers.resources(id)).files;
    assert.equal(files.length, 1);
    assert.equal(papers.matchingPaper(path)?.id, id);
    assert.deepEqual(papers.importFile(path, undefined, id), { pageId: id, reused: true });
    const other = papers.importFile(path);
    assert.notEqual(other.pageId, id);
    assert.equal((await papers.resources(other.pageId)).files[0].id, files[0].id);
    assert.equal(typeof knowledge.get(id).attributes.source_snapshot, "object");
    const stored = database.prepare("SELECT stored_name FROM attachments").get() as { stored_name: string };
    const target = join(info.path, "attachments", stored.stored_name);
    assert.deepEqual(Buffer.from(papers.read(files[0].id)), readFileSync(path));
    writeFileSync(target, "%PDF-1.4\nreplacement");
    assert.throws(() => papers.read(files[0].id), /字节已改变/);
    assert.equal((await papers.resources(id)).files[0].id, files[0].id);
    assert.equal(knowledge.get(id).attributes.source_snapshot && (knowledge.get(id).attributes.source_snapshot as Record<string, unknown>).sha256, files[0].sha256);
});

test("annotation source blocks store only anchor identity and share refreshable quote caches for display and search", async t => {
    const { knowledge, papers, info, database } = fixture(t);
    const id = importPDF(papers, join(info.path, "paper.pdf")), fileId = (await papers.resources(id)).files[0].id;
    const anchor = selection(fileId);
    await papers.mark(id, anchor, "#F2D675");
    const annotationId = await papers.annotate(id, anchor), annotation = knowledge.get(annotationId);
    assert.equal(annotation.kind, "annotation");
    assert.equal(annotation.attributes.annotation_paper, id);
    assert.equal(annotation.attributes.independent, false);
    const source = annotation.blocks[annotation.children[0]];
    assert.equal(source.type, "source");
    assert.deepEqual(source.payload.source, { anchorId: annotation.attributes.annotation_anchor });
    assert.equal(knowledge.backlinks(annotationId)[0].sourceId, id);
    const cache = await papers.getAnchor(String(annotation.attributes.annotation_anchor));
    assert.match(cache.quote, /HELLO/);
    assert.notEqual(cache.quote, anchor.quote);
    assert.equal(cache.extractorVersion, PDF_EXTRACTOR_VERSION);
    assert.match(annotation.excerpt, /HELLO/);
    assert.ok(knowledge.list({ keyword: "HELLO" }).items.some(page => page.id === annotationId));
    database.prepare("UPDATE anchors SET quote='unique refreshed cache phrase' WHERE id=?").run(cache.id);
    assert.ok(knowledge.list({ keyword: "unique refreshed cache phrase" }).items.some(page => page.id === annotationId));
    assert.match(knowledge.get(annotationId).excerpt, /unique refreshed cache phrase/);
    const copy = { ...source, id: randomUUID() };
    const clone = { pageId: annotationId, tabId: "copy", batch: 1, blocks: [copy], pageChildren: [...annotation.children, copy.id] };
    assert.equal(knowledge.commitEdit(clone).status, "saved");
    const altered = { ...copy, id: randomUUID(), payload: { ...copy.payload, source: { anchorId: randomUUID() } } };
    assert.throws(() => knowledge.commitEdit({ ...clone, blocks: [altered] }), /只读/);
    const resources = await papers.resources(id);
    assert.equal(resources.highlights[0].annotationId, annotationId);
    assert.equal(await papers.annotate(id, resources.anchors[0].id), annotationId);
    assert.equal((await papers.resources(id)).highlights.length, 1);
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'annotations'").get(), undefined);
    await assert.rejects(papers.annotate(id, { ...anchor, rectangles: [{ x: 600, y: 800, width: 50, height: 10 }] }), /超出/);
    await assert.rejects(papers.mark(id, { ...anchor, pageNumber: 2 }, "#F2D675"), /页码/);
    assert.equal((await papers.resources(id)).anchors.length, 1);
});

test("deleting annotated highlights confirms retention loss, cancels without writes and recycles through the existing graph", async t => {
    const { knowledge, papers, info } = fixture(t);
    const id = importPDF(papers, join(info.path, "deletion.pdf")), fileId = (await papers.resources(id)).files[0].id;
    const annotationId = await papers.annotate(id, selection(fileId));
    const resources = await papers.resources(id), mark = resources.highlights[0];
    papers.changeHighlight(mark.id, "#A9C5A0");
    assert.equal((await papers.resources(id)).highlights[0].color, "#A9C5A0");
    const before = knowledge.get(id), preview = papers.removeHighlight(mark.id, "delete-pdf");
    assert.equal(preview.status, "confirmation");
    if (preview.status !== "confirmation") throw new Error("expected recycle confirmation");
    assert.ok(preview.preview.recycled.some(page => page.id === annotationId));
    assert.deepEqual(knowledge.get(id).children, before.children);
    assert.equal((await papers.resources(id)).highlights.length, 1);
    assert.equal(knowledge.get(annotationId).attributes.deleted, false);
    const result = papers.removeHighlight(mark.id, "delete-pdf", preview.preview.token);
    assert.equal(result.status, "saved");
    assert.equal((await papers.resources(id)).highlights.length, 0);
    assert.equal(knowledge.get(annotationId).attributes.deleted, true);
    assert.ok(knowledge.list({ deleted: true }).items.some(page => page.id === annotationId));
    assert.equal((await papers.resources(id)).anchors.length, 1);
    knowledge.restore([annotationId], "restore-pdf");
    assert.equal(knowledge.get(annotationId).attributes.deleted, false);
    assert.equal((await papers.resources(id)).highlights.length, 0);
});


test("another reference preserves the annotation after confirmed highlight deletion, and deleted papers stay read-only", async t => {
    const { knowledge, papers, info } = fixture(t);
    const id = importPDF(papers, join(info.path, "retained.pdf")), fileId = (await papers.resources(id)).files[0].id;
    const annotationId = await papers.annotate(id, selection(fileId)), owner = knowledge.create("editable", "Other retention");
    const reference = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id: annotationId } }, children: [] };
    assert.equal(knowledge.commitEdit({ pageId: owner.id, tabId: "other-reference", batch: 1, blocks: [reference], pageChildren: [...owner.children, reference.id] }).status, "saved");
    const mark = (await papers.resources(id)).highlights[0], preview = papers.removeHighlight(mark.id, "remove-retained");
    assert.equal(preview.status, "confirmation");
    if (preview.status !== "confirmation") throw new Error("expected annotation confirmation");
    assert.equal(preview.preview.recycled.length, 0);
    assert.equal(papers.removeHighlight(mark.id, "remove-retained", preview.preview.token).status, "saved");
    assert.equal(knowledge.get(annotationId).attributes.deleted, false);
    await papers.mark(id, selection(fileId), "#F2D675");
    const nextMark = (await papers.resources(id)).highlights[0], trash = knowledge.trash([id], "trash-paper");
    assert.equal(trash.status, "confirmation");
    if (trash.status !== "confirmation") throw new Error("expected paper confirmation");
    knowledge.trash([id], "trash-paper", trash.preview.token);
    const children = knowledge.get(id).children;
    assert.throws(() => papers.removeHighlight(nextMark.id, "deleted-paper"), /回收站/);
    assert.throws(() => papers.changeHighlight(nextMark.id, "#A9C5A0"), /回收站/);
    assert.deepEqual(knowledge.get(id).children, children);
});

test("extractor upgrades recalculate old quote caches from stored PDF rectangles", async t => {
    const { papers, info, database } = fixture(t);
    const id = importPDF(papers, join(info.path, "cache.pdf")), fileId = (await papers.resources(id)).files[0].id;
    await papers.mark(id, selection(fileId), "#F2D675");
    const original = (await papers.resources(id)).anchors[0];
    database.prepare("UPDATE anchors SET quote='stale quotation',context='stale context',extractor_version='old-extractor' WHERE id=?").run(original.id);
    const refreshed = await papers.getAnchor(original.id);
    assert.equal(refreshed.quote, original.quote);
    assert.equal(refreshed.context, original.quote);
    assert.equal(refreshed.extractorVersion, PDF_EXTRACTOR_VERSION);
    assert.deepEqual(refreshed.rectangles, original.rectangles);
    assert.equal((database.prepare("SELECT extractor_version AS version FROM anchors WHERE id=?").get(original.id) as { version: string }).version, PDF_EXTRACTOR_VERSION);
});

test("encrypted PDF passwords stay transient, wrong passwords cannot poison an unlocked cache", async t => {
    const { knowledge, papers, info, database } = fixture(t);
    const path = join(info.path, "encrypted.pdf");
    writeFileSync(path, readFileSync(join(process.cwd(), "tests/fixtures/protected.pdf")));
    const id = papers.importFile(path).pageId, fileId = (await papers.resources(id)).files[0].id;
    await assert.rejects(papers.mark(id, selection(fileId), "#F2D675"), /password/i);
    await assert.rejects(papers.unlockPDF(fileId, "incorrect"), /password/i);
    await papers.unlockPDF(fileId, "reader-pass");
    await papers.mark(id, selection(fileId), "#F2D675");
    const original = (await papers.resources(id)).anchors[0];
    assert.match(original.quote, /HELLO/);
    await assert.rejects(papers.unlockPDF(fileId, "incorrect"), /password/i);
    await papers.mark(id, selection(fileId), "#A9C5A0");
    assert.equal((await papers.resources(id)).highlights.length, 2);
    database.prepare("UPDATE anchors SET quote='stale',extractor_version='old-extractor' WHERE id=?").run(original.id);
    const restarted = new PaperService(knowledge, info.path), locked = await restarted.resources(id);
    assert.equal(locked.files.length, 1);
    assert.equal(locked.anchors[0].quote, "");
    await restarted.unlockPDF(fileId, "reader-pass");
    assert.equal((await restarted.resources(id)).anchors[0].quote, original.quote);
    assert.ok(!String(database.prepare("SELECT group_concat(settings) FROM workspace_meta").pluck().get()).includes("reader-pass"));
});

test("one tab's undo tree spans its document and annotation page edits", async t => {
    const { knowledge, papers, info } = fixture(t), history = new EditHistory(knowledge);
    const id = importPDF(papers, join(info.path, "undo.pdf")), fileId = (await papers.resources(id)).files[0].id;
    const annotationId = await papers.annotate(id, selection(fileId));
    const tabId = "paper-with-popup", paper = knowledge.get(id), note = knowledge.get(annotationId);
    const paragraph = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "document edit"), children: [] };
    assert.equal(knowledge.commitEdit({ pageId: id, tabId, batch: 1, blocks: [paragraph], pageChildren: [...paper.children, paragraph.id] }).status, "saved");
    const noteBlock = note.blocks[note.children.find(child => note.blocks[child].type === "paragraph")!];
    assert.ok(noteBlock);
    assert.equal(knowledge.commitEdit({ pageId: annotationId, tabId, batch: 2, blocks: [{ ...noteBlock, payload: payload("paragraph", "popup typing") }] }).status, "saved");
    assert.equal(history.apply(tabId, "undo").status, "saved");
    assert.equal(knowledge.get(annotationId).blocks[noteBlock.id].payload.inline.length, 0);
    assert.equal(knowledge.get(id).blocks[paragraph.id].payload.inline[0].type, "text");
    const second = history.apply(tabId, "undo");
    assert.equal(second.status, "saved");
    assert.ok(!knowledge.get(id).children.includes(paragraph.id));
});

test("PDF anchor migration clears legacy normalized locations and recycles their annotation bodies", async t => {
    const { knowledge, papers, info, database } = fixture(t);
    const id = importPDF(papers, join(info.path, "legacy.pdf")), fileId = (await papers.resources(id)).files[0].id;
    const anchorId = randomUUID(), sourceId = randomUUID();
    const note = knowledge.create("annotation", "legacy annotation", { annotation_paper: id, annotation_anchor: anchorId }, id);
    database.exec("ALTER TABLE anchors DROP COLUMN extractor_version");
    database.prepare("INSERT INTO anchors(id,file_id,page_number,rectangles,quote,context) VALUES (?,?,1,?,'legacy quote','legacy context')").run(anchorId, fileId, JSON.stringify([{ x: .1, y: .1, width: .2, height: .05 }]));
    database.prepare("INSERT INTO highlights(id,anchor_id,color) VALUES (?,?,'#F2D675')").run(randomUUID(), anchorId);
    database.prepare("INSERT INTO blocks(id,type,content,children) VALUES (?,'source',?,'[]')").run(sourceId, JSON.stringify({ ...payload("source"), source: { fileId, anchorId, quote: "legacy quote" } }));
    database.prepare("UPDATE pages SET children=? WHERE id=?").run(JSON.stringify([sourceId, ...note.children]), note.id);
    database.pragma("user_version = 12");
    database.close();
    const reopened = openWorkspace(info.path);
    t.after(() => reopened.database.close());
    const migrated = new KnowledgeService(reopened.db);
    assert.equal(reopened.database.prepare("SELECT COUNT(*) FROM anchors").pluck().get(), 0);
    assert.equal(reopened.database.prepare("SELECT COUNT(*) FROM highlights").pluck().get(), 0);
    assert.equal(migrated.get(note.id).attributes.deleted, true);
    assert.equal(migrated.get(note.id).attributes.annotation_anchor, null);
    assert.ok(!migrated.get(note.id).children.includes(sourceId));
    assert.equal(migrated.get(id).kind, "paper");
    assert.deepEqual(reopened.database.pragma("foreign_key_check"), []);
});

test("reading position remains a paper attribute without edit conflicts or timestamp changes", async t => {
    const { knowledge, papers, info } = fixture(t);
    const id = importPDF(papers, join(info.path, "reading.pdf")), file = (await papers.resources(id)).files[0];
    const before = knowledge.get(id);
    papers.position(id, file.id, { page: 1, scale: "page-width", rotation: 90, left: 10, top: 700 });
    const after = knowledge.get(id);
    assert.deepEqual(after.blocks, before.blocks);
    assert.deepEqual(after.children, before.children);
    assert.equal(after.attributes.modified_at, before.attributes.modified_at);
    assert.deepEqual(after.attributes.reading_position, { [file.id]: { page: 1, scale: "page-width", rotation: 90, left: 10, top: 700 } });
    assert.throws(() => papers.position(id, randomUUID(), { page: 1, scale: 1, rotation: 0, left: 0, top: 0 }), /无效/);
});

test("anchor rectangles stay in PDF user space including non-zero and negative page origins", () => {
    const rect = { x: 90, y: 720, width: 240, height: 40 };
    assert.deepEqual(rectanglePoints(rect), [90, 720, 330, 760]);
    assert.ok(rectangleWithinPage(rect, [30, 40, 630, 840]));
    assert.ok(rectangleWithinPage({ x: -10, y: -20, width: 15, height: 10 }, [-30, -40, 100, 200]));
    assert.ok(!rectangleWithinPage({ ...rect, width: 700 }, [30, 40, 630, 840]));
    assert.ok(!rectangleWithinPage({ ...rect, x: Number.NaN }, [30, 40, 630, 840]));
});