import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { EditHistory } from "../main/knowledge/history";
import { PaperService } from "../main/knowledge/papers";
import { PurgeService } from "../main/knowledge/purge";
import { payload } from "../shared/content/blocks";
import { PDF_EXTRACTOR_VERSION } from "../shared/content/pdf-text";
import type { CommitResult } from "../shared/types/content";
import { knownCoordinatePdf } from "./fixtures/pdf-text";
import { commands, menus, shortcutCommand } from "../shared/content/commands";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { service: KnowledgeService; history: EditHistory; papers: PaperService; purge: PurgeService } {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "purge-")));
    const service = new KnowledgeService(ws.db), history = new EditHistory(service), papers = new PaperService(service, ws.info.path), purge = new PurgeService(service, history, ws.info.path);
    t.after(() => ws.database.close());
    return { ...ws, service, history, papers, purge };
}
function confirm(action: (token?: string) => CommitResult): void {
    const result = action();
    assert.equal(result.status === "saved" ? result.status : action(result.preview.token).status, "saved");
}
function erase(purge: PurgeService, ids: string[] | null, tab = "purger"): string[] {
    const result = purge.purge(ids, tab);
    if (result.status === "deleted") return result.pages;
    const done = purge.purge(ids, tab, result.token);
    assert.equal(done.status, "deleted");
    if (done.status !== "deleted") throw new Error("Expected deletion");
    return done.pages;
}
test("permanent deletion requires recycle membership, previews without writes, and empties a single-page recycle bin", t => {
    const { service, purge } = fixture(t), page = service.create("editable", "A");
    assert.throws(() => purge.purge([page.id], "a"), /回收站/);
    confirm(token => service.trash([page.id], "a", token));
    const before = service.sql.prepare("SELECT * FROM undo_nodes").all(), preview = purge.purge(null, "a");
    assert.equal(preview.status, "confirmation");
    assert.equal(service.get(page.id).title, "A");
    assert.deepEqual(service.sql.prepare("SELECT * FROM undo_nodes").all(), before);
    assert.deepEqual(erase(purge, null), [page.id]);
    assert.equal(service.list({ deleted: true }).total, 0);
    assert.equal(service.sql.prepare("SELECT count(*) FROM blocks").pluck().get(), 0);
    assert.deepEqual(erase(purge, null), []);
});
test("live synchronized blocks survive while soft references remain deleted and every tab loses affected history", t => {
    const { service, history, purge } = fixture(t), a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
    const shared = a.children[0], own = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "Only A"), children: [] };
    service.commitEdit({ pageId: a.id, tabId: "a", batch: 1, blocks: [own], pageChildren: [shared, own.id] });
    service.commitEdit({ pageId: a.id, tabId: "other", batch: 1, blocks: [{ ...own, payload: payload("paragraph", "Other tab edit") }] });
    service.commitEdit({ pageId: b.id, tabId: "b", batch: 1, blocks: [], pageChildren: [shared] });
    const ref = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id: a.id } }, children: [] };
    const refBlock = { ...ref, id: randomUUID(), payload: { ...payload("blocked_reference"), target: { kind: "block" as const, id: own.id } } };
    service.commitEdit({ pageId: c.id, tabId: "c", batch: 1, blocks: [ref, refBlock], pageChildren: [ref.id, refBlock.id] });
    confirm(token => service.trash([a.id], "a", token));
    const preview = purge.purge([a.id], "a");
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") assert.equal(preview.links, 2);
    assert.equal(history.state("other").canUndo, true);
    erase(purge, [a.id], "a");
    assert.equal(history.state("other").canUndo, false);
    assert.ok(service.get(b.id).blocks[shared]);
    assert.equal(service.resolve({ kind: "page", id: a.id }), null);
    assert.deepEqual(service.get(c.id).children, [ref.id, refBlock.id]);
    assert.equal(service.resolve({ kind: "block", id: own.id })?.status, "deleted");
    assert.equal(service.blockRow(own.id), null, "soft references in history do not preserve physical target rows");
    assert.equal(history.state("a").canUndo, false);
    assert.equal(history.state("b").canUndo, true);
    assert.equal(history.state("c").canUndo, true);
    assert.equal(service.sql.prepare("SELECT count(*) FROM undo_objects WHERE object_key=?").pluck().get("page:" + a.id), 0);
    assert.deepEqual(service.sql.prepare("PRAGMA foreign_key_check").all(), []);
});
test("a changed recycle set invalidates a previously confirmed empty-trash scope", t => {
    const { service, purge } = fixture(t), a = service.create("editable", "A"), b = service.create("editable", "B");
    confirm(token => service.trash([a.id], "a", token));
    const first = purge.purge(null, "a");
    assert.equal(first.status, "confirmation");
    if (first.status !== "confirmation") return;
    confirm(token => service.trash([b.id], "b", token));
    const next = purge.purge(null, "a", first.token);
    assert.equal(next.status, "confirmation");
    assert.equal(service.list({ deleted: true }).total, 2);
});
async function annotated(t: TestContext): Promise<ReturnType<typeof fixture> & { id: string; annotation: string; file: string; path: string }> {
    const f = fixture(t), path = join(f.info.path, "paper.pdf");
    writeFileSync(path, knownCoordinatePdf());
    const id = f.papers.importFile(path).pageId, file = (await f.papers.resources(id)).files[0];
    const annotation = await f.papers.annotate(id, { fileId: file.id, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "", context: "", extractorVersion: PDF_EXTRACTOR_VERSION });
    const stored = f.database.prepare("SELECT stored_name FROM attachments WHERE id=?").pluck().get(file.id) as string;
    return { ...f, id, annotation, file: join(f.info.path, "attachments", stored), path };
}
test("purging a paper cascades to solely retained recycled annotations and removes PDF bytes, anchors, highlights and reminders", async t => {
    const { service, purge, id, annotation, file } = await annotated(t);
    confirm(token => service.trash([id], "paper", token));
    assert.equal(service.flags(annotation).deleted, true);
    const preview = purge.purge([id], "paper");
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") assert.deepEqual(new Set(preview.pages.map(page => page.id)), new Set([id, annotation]));
    service.sql.prepare("INSERT INTO reminder_schedules(id,page_id,scheduled_at,state) VALUES (?,?,1,'pending')").run(randomUUID(), id);
    assert.deepEqual(new Set(erase(purge, [id])), new Set([id, annotation]));
    assert.equal(existsSync(file), false);
    for (const table of ["attachments", "page_attachments", "anchors", "highlights", "reminder_schedules"]) assert.equal(service.sql.prepare("SELECT count(*) FROM " + table).pluck().get(), 0, table);
});
test("another live or recycled paper retains an annotation and the immutable attachment it still needs", async t => {
    const { service, purge, id, annotation, file } = await annotated(t);
    const other = service.create("paper", "B");
    const ref = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id: annotation } }, children: [] };
    service.commitEdit({ pageId: other.id, tabId: "other", batch: 1, blocks: [ref], pageChildren: [ref.id] });
    confirm(token => service.trash([id, other.id], "both", token));
    assert.equal(service.flags(annotation).deleted, true);
    assert.deepEqual(erase(purge, [id]), [id]);
    assert.equal(service.get(annotation).kind, "annotation");
    assert.equal(existsSync(file), true);
    assert.deepEqual(new Set(erase(purge, [other.id])), new Set([other.id, annotation]));
    assert.equal(existsSync(file), false);
});
test("shared attachments remain until their last paper is purged", async t => {
    const { service, purge, papers, info } = fixture(t), path = join(info.path, "shared.pdf");
    writeFileSync(path, knownCoordinatePdf());
    const a = papers.importFile(path).pageId, b = papers.importFile(path).pageId, stored = service.sql.prepare("SELECT stored_name FROM attachments").pluck().get() as string, file = join(info.path, "attachments", stored);
    confirm(token => service.trash([a, b], "trash", token));
    erase(purge, [a]); assert.equal(existsSync(file), true);
    erase(purge, [b]); assert.equal(existsSync(file), false);
});
test("a deleted plain highlight cannot keep its purged PDF through an obsolete undo node", async t => {
    const { service, history, purge, papers, info } = fixture(t), path = join(info.path, "plain.pdf");
    writeFileSync(path, knownCoordinatePdf());
    const page = papers.importFile(path).pageId, fileId = (await papers.resources(page)).files[0].id;
    await papers.mark(page, { fileId, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "", context: "", extractorVersion: PDF_EXTRACTOR_VERSION }, "#F2D675");
    const mark = (await papers.resources(page)).highlights[0];
    confirm(token => papers.removeHighlight(mark.id, "highlight-tab", token));
    assert.equal(history.state("highlight-tab").canUndo, true);
    confirm(token => service.trash([page], "trash", token));
    erase(purge, [page]);
    assert.equal(history.state("highlight-tab").canUndo, false);
    assert.equal(service.sql.prepare("SELECT count(*) FROM attachments").pluck().get(), 0);
});
test("menus and shortcut dispatch use the same table, respect editor handling and ignore composing input", () => {
    const event = (key: string, overrides = {}): Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing" | "defaultPrevented"> => ({ key, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, isComposing: false, defaultPrevented: false, ...overrides });
    for (const [id, definition] of Object.entries(commands)) {
        if (!definition.shortcut) continue;
        const parts = definition.shortcut.split("+"), key = parts.at(-1)!;
        assert.equal(shortcutCommand(event(key, { ctrlKey: parts.includes("Ctrl"), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift") })), id);
        assert.equal(shortcutCommand(event(key, { isComposing: true })), undefined);
    }
    assert.equal(shortcutCommand(event("b")), undefined);
    assert.equal(shortcutCommand(event("n", { defaultPrevented: true })), undefined);
    assert.equal(shortcutCommand(event("n", { isComposing: true })), undefined);
    assert.deepEqual(new Set(menus.map(menu => menu.label)), new Set(["文件", "编辑", "视图", "前往", "帮助"]));
    assert.ok(menus.flatMap(menu => menu.items).includes("attributes"));
});