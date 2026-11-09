import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { PaperService } from "../main/knowledge/papers";
import { normalizeRectangle, pdfRectangle } from "../shared/content/anchors";
import { type AnchorInput } from "../shared/types/papers";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { knowledge: KnowledgeService; papers: PaperService } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "paper-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const knowledge = new KnowledgeService(workspace.db), papers = new PaperService(knowledge, workspace.info.path);
    return { ...workspace, knowledge, papers };
}
function importPDF(papers: PaperService, path: string): string {
    writeFileSync(path, "%PDF-1.4\nfixture bytes");
    return papers.importFile(path).pageId;
}

test("managed attachments preserve identity and reject replaced bytes; identical import opens its existing paper", t => {
    const { knowledge, papers, info, database } = fixture(t);
    const path = join(info.path, "original.pdf"), id = importPDF(papers, path);
    const files = papers.resources(id).files;
    assert.equal(files.length, 1);
    assert.equal(papers.matchingPaper(path)?.id, id);
    assert.deepEqual(papers.importFile(path, undefined, id), { pageId: id, reused: true });
    const other = papers.importFile(path);
    assert.notEqual(other.pageId, id);
    assert.equal(papers.resources(other.pageId).files[0].id, files[0].id);
    const snapshot = knowledge.get(id).attributes.source_snapshot;
    assert.equal(typeof snapshot, "object");
    const stored = database.prepare("SELECT stored_name FROM attachments").get() as { stored_name: string };
    const target = join(info.path, "attachments", stored.stored_name);
    assert.deepEqual(Buffer.from(papers.read(files[0].id)), readFileSync(path));
    writeFileSync(target, "%PDF-1.4\nreplacement");
    assert.throws(() => papers.read(files[0].id), /字节已改变/);
    assert.equal(papers.resources(id).files[0].id, files[0].id);
    assert.equal(knowledge.get(id).attributes.source_snapshot && (knowledge.get(id).attributes.source_snapshot as Record<string, unknown>).sha256, files[0].sha256);
});

test("annotation pages use attributes and reference entries; removing highlights never removes annotations or anchors", t => {
    const { knowledge, papers, info, database } = fixture(t);
    const id = importPDF(papers, join(info.path, "paper.pdf")), fileId = papers.resources(id).files[0].id;
    const anchor: AnchorInput = { fileId, pageNumber: 2, rectangles: [{ x: .1, y: .2, width: .3, height: .04 }], quote: "Source quotation", context: "Context" };
    papers.mark(id, anchor, "#F2D675");
    const annotationId = papers.annotate(id, anchor), annotation = knowledge.get(annotationId);
    assert.equal(annotation.kind, "annotation");
    assert.equal(annotation.attributes.annotation_paper, id);
    assert.equal(annotation.attributes.independent, false);
    assert.equal(annotation.blocks[annotation.children[0]].type, "source");
    assert.equal(knowledge.backlinks(annotationId)[0].sourceId, id);
    const source = annotation.blocks[annotation.children[0]];
    const copy = { ...source, id: crypto.randomUUID() };
    const clone = { pageId: annotationId, tabId: "copy", batch: 1, blocks: [copy], pageChildren: [...annotation.children, copy.id] };
    assert.equal(knowledge.commitEdit(clone).status, "saved");
    const altered = { ...copy, payload: { ...copy.payload, source: { ...copy.payload.source!, quote: "Altered" } } };
    assert.throws(() => knowledge.commitEdit({ ...clone, blocks: [altered] }), /只读/);
    const before = papers.resources(id);
    assert.equal(before.highlights[0].anchorId, annotation.attributes.annotation_anchor);
    papers.removeHighlight(before.highlights[0].id);
    const after = papers.resources(id);
    assert.equal(after.highlights.length, 0);
    assert.equal(after.anchors.length, before.anchors.length);
    assert.equal(knowledge.get(annotationId).attributes.deleted, false);
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'annotations'").get(), undefined);
    const count = after.anchors.length;
    assert.throws(() => papers.annotate(id, { ...anchor, rectangles: [{ x: .9, y: .2, width: .5, height: .1 }] }), /超出/);
    assert.equal(papers.resources(id).anchors.length, count);
});

test("reading position is a paper attribute and does not create edit conflicts or change the page timestamp", t => {
    const { knowledge, papers, info } = fixture(t);
    const id = importPDF(papers, join(info.path, "reading.pdf")), file = papers.resources(id).files[0];
    const before = knowledge.get(id);
    papers.position(id, file.id, { page: 2, scale: "page-width", rotation: 90, left: 10, top: 700 });
    const after = knowledge.get(id);
    assert.deepEqual(after.blocks, before.blocks);
    assert.deepEqual(after.children, before.children);
    assert.equal(after.attributes.modified_at, before.attributes.modified_at);
    assert.deepEqual(after.attributes.reading_position, { [file.id]: { page: 2, scale: "page-width", rotation: 90, left: 10, top: 700 } });
    assert.throws(() => papers.position(id, randomUUID(), { page: 1, scale: 1, rotation: 0, left: 0, top: 0 }), /无效/);
});

test("anchor coordinates round-trip with non-zero crop origins", () => {
    const crop = [30, 40, 630, 840], source: [number, number, number, number] = [90, 760, 330, 720];
    const rect = normalizeRectangle(source, crop);
    assert.deepEqual(rect, { x: .1, y: .1, width: .4, height: .05 });
    assert.deepEqual(pdfRectangle(rect, crop), source);
});