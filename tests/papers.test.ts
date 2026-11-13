import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { PaperService } from "../main/knowledge/papers";
import { EditHistory } from "../main/knowledge/history";
import { unreferencedFiles } from "../main/storage/files";
import { PurgeService } from "../main/knowledge/purge";
import { rectanglePoints, rectangleWithinPage } from "../shared/content/anchors";
import { PDF_EXTRACTOR_VERSION } from "../shared/content/pdf-text";
import { payload } from "../shared/content/blocks";
import { type AnnotationInput } from "../shared/types/papers";
import { knownCoordinatePdf } from "./fixtures/pdf-text";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { knowledge: KnowledgeService; papers: PaperService; history: EditHistory } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "paper-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const knowledge = new KnowledgeService(workspace.db), papers = new PaperService(knowledge, workspace.info.path), history = new EditHistory(knowledge);
    return { ...workspace, knowledge, papers, history };
}
function importPDF(papers: PaperService, path: string): string {
    writeFileSync(path, knownCoordinatePdf());
    return papers.importFile(path).pageId;
}
function selection(fileId: string): AnnotationInput {
    return { fileId, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "Untrusted client quotation", context: "Context", extractorVersion: PDF_EXTRACTOR_VERSION };
}

test("identical imports create independent papers, attachment rows and files, with size checks and no stored hash", async t => {
    const { knowledge, papers, info, database } = fixture(t);
    const path = join(info.path, "original.pdf"), id = importPDF(papers, path);
    const files = (await papers.resources(id)).files;
    assert.equal(files.length, 1);
    const other = papers.importFile(path);
    assert.notEqual(other.pageId, id);
    const second = (await papers.resources(other.pageId)).files[0];
    assert.notEqual(second.id, files[0].id);
    assert.equal(knowledge.list({ kind: "paper" }).total, 2);
    assert.equal(database.prepare("SELECT count(*) FROM attachments").pluck().get(), 2);
    assert.equal(readdirSync(join(info.path, "attachments")).length, 2);
    assert.deepEqual(knowledge.get(id).attributes.source_snapshot, { originalName: "original.pdf" });
    assert.ok(!(database.pragma("table_info(attachments)") as { name: string }[]).some(column => column.name === "sha256"));
    const stored = database.prepare("SELECT stored_name FROM attachments WHERE id=?").get(files[0].id) as { stored_name: string };
    const target = join(info.path, "attachments", stored.stored_name);
    assert.deepEqual(Buffer.from(papers.read(files[0].id)), readFileSync(path));
    const sameSize = Buffer.from(readFileSync(path)); sameSize[sameSize.length - 1] ^= 1;
    writeFileSync(target, sameSize);
    assert.deepEqual(Buffer.from(papers.read(files[0].id)), sameSize, "reading checks size without a content hash");
    writeFileSync(target, "%PDF-1.4\nreplacement");
    assert.throws(() => papers.read(files[0].id), /attachment-size-changed/);
    assert.equal((await papers.resources(id)).files[0].id, files[0].id);
    assert.deepEqual(Buffer.from(papers.read(second.id)), readFileSync(path));
});

test("annotation creation is retained, reversible and has an empty paragraph, while repeated selections create distinct pages", async t => {
    const { knowledge, papers, info, history } = fixture(t), paperId = importPDF(papers, join(info.path, "A.pdf"));
    const fileId = (await papers.resources(paperId)).files[0].id, input = selection(fileId), id = await papers.annotate(paperId, input, "annotations");
    const page = knowledge.get(id);
    assert.equal(page.kind, "annotation"); assert.equal(page.attributes.independent, false);
    assert.deepEqual(knowledge.get(paperId).attributes.paper_annotations, [id]);
    assert.equal(page.children.length, 1); assert.equal(page.blocks[page.children[0]].type, "paragraph");
    assert.equal(page.excerpt, ""); assert.match(page.attributes.annotation_quote as string, /HELLO/);
    assert.equal(page.attributes.annotation_color, "yellow"); assert.equal(page.attributes.annotation_file, fileId);
    assert.deepEqual(knowledge.backlinks(id)[0].sourceFields, ["paper_annotations"]);
    assert.equal((await papers.resources(paperId)).annotations.length, 1);
    assert.equal(history.apply("annotations", "undo").status, "saved");
    assert.deepEqual(knowledge.get(paperId).attributes.paper_annotations, []);
    assert.equal(knowledge.get(id).attributes.deleted, true);
    assert.deepEqual((await papers.resources(paperId)).annotations, []);
    assert.equal(history.apply("annotations", "redo").status, "saved");
    assert.deepEqual(knowledge.get(paperId).attributes.paper_annotations, [id]);
    assert.equal((await papers.resources(paperId)).annotations[0].id, id);
    const read = knowledge.get.bind(knowledge), reads: string[] = [];
    const observed = t.mock.method(knowledge, "get", (pageId: string) => {
        reads.push(pageId); return read(pageId);
    });
    const second = await papers.annotate(paperId, input, "annotations");
    assert.ok(!reads.includes(id), "creating another selection never loads an existing annotation body to compare positions");
    observed.mock.restore();
    assert.notEqual(second, id);
    assert.deepEqual(knowledge.get(paperId).attributes.paper_annotations, [id, second]);
    assert.equal(await papers.annotate(paperId, id, "annotations"), id, "opening an existing annotation uses its own identity");
    assert.equal((await papers.resources(paperId)).annotations.length, 2);
    history.apply("annotations", "undo");
    assert.deepEqual(knowledge.get(paperId).attributes.paper_annotations, [id]);
    assert.equal(knowledge.flags(second).deleted, true);
    history.apply("annotations", "redo");
    assert.deepEqual(knowledge.get(paperId).attributes.paper_annotations, [id, second]);
    await assert.rejects(papers.annotate(paperId, { ...input, pageNumber: 2 }, "annotations"), hasFailure("pdf-page-range"));
    await assert.rejects(papers.annotate(paperId, { ...input, rectangles: [{ x: 600, y: 800, width: 50, height: 10 }] }, "annotations"), hasFailure("annotation-outside-page"));
});

test("color, deletion, undo, redo and restore are ordinary annotation edits and preserve paper membership", async t => {
    const { knowledge, papers, info, history } = fixture(t), paperId = importPDF(papers, join(info.path, "A.pdf"));
    const id = await papers.annotate(paperId, selection((await papers.resources(paperId)).files[0].id), "annotations");
    assert.equal(papers.changeAnnotation(id, "green", "annotations").status, "saved");
    assert.equal((await papers.resources(paperId)).annotations[0].color, "green");
    assert.equal(history.apply("annotations", "undo").status, "saved");
    assert.equal((await papers.resources(paperId)).annotations[0].color, "yellow");
    const preview = papers.deleteAnnotation(id, "annotations");
    assert.equal(preview.status, "confirmation");
    assert.equal(knowledge.get(id).attributes.deleted, false);
    if (preview.status !== "confirmation") throw new Error("Expected confirmation");
    assert.equal(papers.deleteAnnotation(id, "annotations", preview.preview.token).status, "saved");
    assert.equal(knowledge.get(id).attributes.recycle_reason, "manual_delete");
    assert.deepEqual(knowledge.get(paperId).attributes.paper_annotations, [id]);
    assert.equal((await papers.resources(paperId)).annotations.length, 0);
    assert.equal(history.apply("annotations", "undo").status, "saved");
    assert.equal((await papers.resources(paperId)).annotations[0].id, id);
    assert.equal(history.apply("annotations", "redo").status, "saved");
    assert.equal((await papers.resources(paperId)).annotations.length, 0);
    assert.equal(knowledge.restore([id], "restore").status, "saved");
    assert.equal((await papers.resources(paperId)).annotations[0].id, id);
    assert.equal(knowledge.get(id).attributes.independent, false);
});

test("ordinary reference blocks and inline links retain annotations without displaying or searching a special quote block", async t => {
    const { knowledge, papers, info } = fixture(t), paperId = importPDF(papers, join(info.path, "A.pdf"));
    const fileId = (await papers.resources(paperId)).files[0].id, id = await papers.annotate(paperId, selection(fileId), "annotations");
    const inlineId = await papers.annotate(paperId, { ...selection(fileId), rectangles: [{ x: 150, y: 690, width: 60, height: 30 }] }, "annotations");
    const unreferenced = await papers.annotate(paperId, { ...selection(fileId), rectangles: [{ x: 50, y: 690, width: 150, height: 30 }] }, "annotations");
    const note = knowledge.create("editable", "B");
    const reference = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id } }, children: [] };
    const inline = { id: randomUUID(), type: "paragraph" as const, payload: { ...payload("paragraph"), inline: [{ type: "inlineReference" as const, attrs: { target: { kind: "page" as const, id: inlineId }, label: knowledge.title(inlineId) } }] }, children: [] };
    assert.equal(knowledge.commitEdit({ pageId: note.id, tabId: "note", batch: 0, blocks: [reference, inline], pageChildren: [reference.id, inline.id] }).status, "saved");
    assert.deepEqual(knowledge.statement("SELECT target_kind,target_id FROM link_refs WHERE source_id=?").all(reference.id), [{ target_kind: "page", target_id: id }]);
    assert.ok(knowledge.list({ keyword: "HELLO" }).items.some(page => page.id === id));
    knowledge.attributes.cache(id, { annotation_quote: "unique-cache-phrase" });
    assert.deepEqual(knowledge.list({ keyword: "unique-cache-phrase" }).items.map(page => page.id), [id]);
    const preview = knowledge.trash([paperId], "trash");
    if (preview.status !== "confirmation") throw new Error("Expected confirmation");
    assert.equal(knowledge.trash([paperId], "trash", preview.preview.token).status, "saved");
    assert.equal(knowledge.flags(id).deleted, false);
    assert.equal(knowledge.flags(inlineId).deleted, false);
    assert.equal(knowledge.flags(unreferenced).deleted, true);
});

test("extractor refresh updates cache attributes without history or modification times", async t => {
    const { knowledge, papers, info, history, database } = fixture(t), paperId = importPDF(papers, join(info.path, "A.pdf"));
    const id = await papers.annotate(paperId, selection((await papers.resources(paperId)).files[0].id), "annotations"), original = await papers.getAnnotation(id);
    knowledge.attributes.cache(id, { annotation_quote: "stale", annotation_context: "stale", annotation_extractor: "old" });
    const before = knowledge.get(id), undo = history.state("annotations"), modified = database.prepare("SELECT last_modified_at FROM workspace_meta").pluck().get();
    const refreshed = await papers.getAnnotation(id);
    assert.equal(refreshed.quote, original.quote); assert.equal(refreshed.context, original.quote); assert.equal(refreshed.extractorVersion, PDF_EXTRACTOR_VERSION);
    assert.deepEqual(refreshed.rectangles, original.rectangles);
    assert.deepEqual(history.state("annotations"), undo);
    assert.equal(knowledge.get(id).attributes.modified_at, before.attributes.modified_at);
    assert.equal(database.prepare("SELECT last_modified_at FROM workspace_meta").pluck().get(), modified);
});

test("encrypted PDF passwords stay transient and repeated selections produce independent annotation pages", async t => {
    const { knowledge, papers, info, database } = fixture(t), path = join(info.path, "encrypted.pdf");
    writeFileSync(path, readFileSync(join(process.cwd(), "tests/fixtures/protected.pdf")));
    const paperId = papers.importFile(path).pageId, fileId = (await papers.resources(paperId)).files[0].id;
    await assert.rejects(papers.annotate(paperId, selection(fileId), "annotations"), hasFailure("pdf-password-required"));
    await assert.rejects(papers.unlockPDF(fileId, "incorrect"), hasFailure("pdf-password-incorrect"));
    await papers.unlockPDF(fileId, "reader-pass");
    const id = await papers.annotate(paperId, selection(fileId), "annotations"), original = await papers.getAnnotation(id);
    await assert.rejects(papers.unlockPDF(fileId, "incorrect"), hasFailure("pdf-password-incorrect"));
    const second = await papers.annotate(paperId, selection(fileId), "annotations", "green");
    assert.notEqual(second, id);
    assert.equal((await papers.resources(paperId)).annotations.length, 2);
    assert.equal((await papers.getAnnotation(second)).color, "green");
    knowledge.attributes.cache(id, { annotation_quote: "stale", annotation_extractor: "old" });
    const restarted = new PaperService(knowledge, info.path);
    assert.equal((await restarted.resources(paperId)).annotations[0].quote, "");
    await restarted.unlockPDF(fileId, "reader-pass");
    assert.equal((await restarted.resources(paperId)).annotations[0].quote, original.quote);
    assert.ok(!String(database.prepare("SELECT group_concat(value) FROM page_attrs").pluck().get()).includes("reader-pass"));
});

test("annotation text controls the reader icon, while one tab's undo tree spans paper and popup edits", async t => {
    const { knowledge, papers, info, history } = fixture(t), paperId = importPDF(papers, join(info.path, "A.pdf"));
    const id = await papers.annotate(paperId, selection((await papers.resources(paperId)).files[0].id), "annotations"), tabId = "annotations";
    const paper = knowledge.get(paperId), paragraph = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "Paper edit"), children: [] };
    knowledge.commitEdit({ pageId: paperId, tabId, batch: 0, blocks: [paragraph], pageChildren: [...paper.children, paragraph.id] });
    const note = knowledge.get(id), body = note.blocks[note.children[0]];
    knowledge.commitEdit({ pageId: id, tabId, batch: 0, blocks: [{ ...body, payload: payload("paragraph", "Popup text") }] });
    assert.equal((await papers.resources(paperId)).annotations[0].hasText, true);
    assert.equal(history.apply(tabId, "undo").status, "saved");
    assert.equal((await papers.resources(paperId)).annotations[0].hasText, false);
    assert.ok(knowledge.get(paperId).children.includes(paragraph.id));
    assert.equal(history.apply(tabId, "undo").status, "saved");
    assert.ok(!knowledge.get(paperId).children.includes(paragraph.id));
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
    assert.throws(() => papers.position(id, randomUUID(), { page: 1, scale: 1, rotation: 0, left: 0, top: 0 }), hasFailure("paper-invalid-position"));
});

test("annotation rectangles stay in PDF user space including non-zero and negative page origins", () => {
    const rect = { x: 90, y: 720, width: 240, height: 40 };
    assert.deepEqual(rectanglePoints(rect), [90, 720, 330, 760]);
    assert.ok(rectangleWithinPage(rect, [30, 40, 630, 840]));
    assert.ok(rectangleWithinPage({ x: -10, y: -20, width: 15, height: 10 }, [-30, -40, 100, 200]));
    assert.ok(!rectangleWithinPage({ ...rect, width: 700 }, [30, 40, 630, 840]));
    assert.ok(!rectangleWithinPage({ ...rect, x: Number.NaN }, [30, 40, 630, 840]));
});

test("annotation file references retain detached files and purging clears membership in the owning paper", async t => {
    const { knowledge, papers, info, history } = fixture(t), path = join(info.path, "A.pdf"), paperId = importPDF(papers, path);
    const file = (await papers.resources(paperId)).files[0], id = await papers.annotate(paperId, selection(file.id), "annotations");
    knowledge.commitEdit({ pageId: paperId, tabId: "files", batch: 0, blocks: [], attributes: { paper_files: [] } });
    assert.deepEqual(unreferencedFiles(knowledge.db), []);
    assert.equal((await papers.resources(paperId)).annotations.length, 0);
    assert.match((await papers.getAnnotation(id)).quote, /HELLO/);
    const other = papers.importFile(path).pageId;
    await assert.rejects(papers.annotate(other, selection(file.id), "other"), /paper-file-removed/);
    const otherFile = (await papers.resources(other)).files[0];
    const otherAnnotation = await papers.annotate(other, selection(otherFile.id), "other");
    const removal = papers.deleteAnnotation(id, "annotations");
    if (removal.status !== "confirmation") throw new Error("Expected confirmation");
    papers.deleteAnnotation(id, "annotations", removal.preview.token);
    const purge = new PurgeService(knowledge, history, info.path), preview = purge.purge([id], "purge");
    if (preview.status !== "confirmation") throw new Error("Expected confirmation");
    assert.equal(purge.purge([id], "purge", preview.token).status, "deleted");
    assert.deepEqual(knowledge.get(paperId).attributes.paper_annotations, []);
    assert.deepEqual(knowledge.get(other).attributes.paper_annotations, [otherAnnotation]);
    assert.ok(!papers.files().some(row => row.id === file.id));
    assert.deepEqual(unreferencedFiles(knowledge.db), []);
});

test("identical PDFs have independent annotations and a second paper cannot adopt an existing annotation", async t => {
    const { knowledge, papers, info, history } = fixture(t), path = join(info.path, "A.pdf"), first = importPDF(papers, path);
    const file = (await papers.resources(first)).files[0], id = await papers.annotate(first, selection(file.id), "first");
    const second = papers.importFile(path).pageId;
    const secondFile = (await papers.resources(second)).files[0];
    const secondId = await papers.annotate(second, selection(secondFile.id), "second");
    assert.notEqual(secondId, id);
    assert.deepEqual((await papers.getAnnotation(secondId)).rectangles, (await papers.getAnnotation(id)).rectangles);
    assert.throws(() => knowledge.attributes.write(second, { paper_annotations: [id, secondId] }, true), /annotation-owned/);
    assert.throws(() => knowledge.create("paper", "C", { paper_annotations: [id] }), /annotation-owned/);
    assert.equal(history.apply("first", "undo").status, "saved");
    assert.deepEqual(knowledge.get(first).attributes.paper_annotations, []);
    assert.deepEqual(knowledge.get(second).attributes.paper_annotations, [secondId]);
    assert.equal(knowledge.flags(id).deleted, true);
    assert.equal((await papers.resources(second)).annotations[0].id, secondId);
    history.apply("first", "redo");
    const removal = knowledge.trash([first], "trash");
    if (removal.status === "confirmation") knowledge.trash([first], "trash", removal.preview.token);
    assert.throws(() => knowledge.attributes.write(second, { paper_annotations: [id, secondId] }, true), /annotation-owned/, "recycled annotations still belong to their original paper");
});

test("annotation edits invalidate every retaining paper and cross-tab typing invalidates its creation undo", async t => {
    const { knowledge, papers, info, history } = fixture(t), paperId = importPDF(papers, join(info.path, "A.pdf")), fileId = (await papers.resources(paperId)).files[0].id;
    const id = await papers.annotate(paperId, selection(fileId), "creator");
    assert.equal(history.state("creator").canUndo, true);
    const annotation = knowledge.get(id), body = annotation.blocks[annotation.children[0]], changes: string[][] = [];
    knowledge.onChanged = change => changes.push(change.pages);
    knowledge.commitEdit({ pageId: id, tabId: "other-window", batch: 0, blocks: [{ ...body, payload: payload("paragraph", "B") }] });
    assert.equal(history.state("creator").canUndo, false);
    assert.ok(changes[0].includes(id)); assert.ok(changes[0].includes(paperId));
    changes.length = 0; papers.changeAnnotation(id, "pink", "other-window");
    assert.ok(changes[0].includes(paperId));
});