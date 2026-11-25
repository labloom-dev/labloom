import { pageHistory, workspaceHistory } from "./support/history";
import { knowledgeServices, historyServices, paperServices, purgeServices, session, type Knowledge, type History, type Papers, type Purge } from "./support/session";
import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "./support/session";
import { payload } from "../shared/content/blocks";
import { PDF_EXTRACTOR_VERSION } from "../shared/content/pdf-text";
import type { CommitResult } from "../shared/types/content";
import { knownCoordinatePdf } from "./fixtures/pdf-text";
import { createI18n } from "../shared/i18n";
import { commands, menus, shortcutCommand, type Command } from "../shared/content/commands";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { service: Knowledge; history: History; papers: Papers; purge: Purge } {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "purge-")));
    const service = knowledgeServices(), history = historyServices(), papers = paperServices(), purge = purgeServices();
    t.after(() => session.close());
    return { ...ws, service, history, papers, purge };
}
function confirm(action: (token?: string) => CommitResult): void {
    const result = action();
    assert.equal(result.status === "saved" ? result.status : action(result.preview.token).status, "saved");
}
function erase(purge: Purge, ids: string[] | null): string[] {
    const result = purge.purge(ids);
    if (result.status === "deleted") return result.pages;
    const done = purge.purge(ids, result.token);
    assert.equal(done.status, "deleted");
    if (done.status !== "deleted") throw new Error("Expected deletion");
    return done.pages;
}
test("permanent deletion requires recycle membership, previews without writes, and empties a single-page recycle bin", t => {
    const { service, history, purge } = fixture(t), page = service.create("editable", "A");
    assert.throws(() => purge.purge([page.id]), hasFailure("purge-recycled-only"));
    confirm(token => service.trash([page.id], workspaceHistory, token));
    const before = history.state(pageHistory(page.id)), preview = purge.purge(null);
    assert.equal(preview.status, "confirmation");
    assert.equal(service.get(page.id).title, "A");
    assert.deepEqual(history.state(pageHistory(page.id)), before);
    assert.deepEqual(erase(purge, null), [page.id]);
    assert.equal(service.list({ deleted: true }).total, 0);
    assert.equal(service.sql.prepare("SELECT count(*) FROM blocks").pluck().get(), 0);
    assert.deepEqual(erase(purge, null), []);
});
test("live synchronized blocks survive while history depending on collected blocks is discarded", t => {
    const { service, history, purge } = fixture(t), a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
    const shared = a.children[0], own = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "Only A"), children: [] };
    service.commitEdit({ pageId: a.id, batch: 1, blocks: [own], pageChildren: [shared, own.id] }, pageHistory(a.id));
    service.commitEdit({ pageId: a.id, batch: 1, blocks: [{ ...own, payload: payload("paragraph", "Other tab edit") }] }, pageHistory(a.id));
    service.commitEdit({ pageId: b.id, batch: 1, blocks: [], pageChildren: [shared] }, pageHistory(b.id));
    const ref = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id: a.id } }, children: [] };
    const refBlock = { ...ref, id: randomUUID(), payload: { ...payload("blocked_reference"), target: { kind: "block" as const, id: own.id } } };
    service.commitEdit({ pageId: c.id, batch: 1, blocks: [ref, refBlock], pageChildren: [ref.id, refBlock.id] }, pageHistory(c.id));
    confirm(token => service.trash([a.id], workspaceHistory, token));
    const preview = purge.purge([a.id]);
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") assert.equal(preview.links, 2);
    assert.equal(history.state(pageHistory(a.id)).canUndo, true);
    erase(purge, [a.id]);
    assert.equal(history.state(pageHistory(a.id)).canUndo, false);
    assert.ok(service.get(b.id).blocks[shared]);
    assert.equal(service.resolve({ kind: "page", id: a.id }), null);
    assert.deepEqual(service.get(c.id).children, [ref.id, refBlock.id]);
    assert.equal(service.resolve({ kind: "block", id: own.id })?.status, "deleted");
    assert.equal(service.blockRow(own.id), null, "soft references in history do not preserve physical target rows");
    assert.equal(history.state(pageHistory(a.id)).canUndo, false);
    assert.equal(history.state(pageHistory(b.id)).canUndo, false);
    assert.equal(history.state(pageHistory(c.id)).canUndo, false);
    assert.throws(() => history.apply(pageHistory(c.id), "undo"), hasFailure("history-empty"));
    assert.deepEqual(service.sql.prepare("PRAGMA foreign_key_check").all(), []);
});
test("purging collects rootless containers together with deleted children and preserves recycled trees", t => {
    const { service, history, purge } = fixture(t), a = service.create("editable", "A"), d = service.create("editable", "D"), recycled = service.create("editable", "Recycled");
    const parent = a.blocks[a.children[0]], child = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "C"), children: [] };
    service.commitEdit({ pageId: a.id, batch: 0, blocks: [{ ...parent, children: [child.id] }, child] }, pageHistory(a.id));
    service.commitEdit({ pageId: d.id, batch: 0, blocks: [], pageChildren: [child.id] }, pageHistory(d.id));
    // A soft link does not retain the rootless parent, but must survive target deletion.
    service.commitEdit({ pageId: a.id, batch: 1, blocks: [{ ...a.blocks[a.titleBlockId], payload: { ...payload("title"), inline: [{ type: "inlineReference", attrs: { target: { kind: "block", id: parent.id }, label: "B" } }] } }] }, pageHistory(a.id));
    confirm(token => service.deleteBlock({ pageId: a.id, blockId: parent.id }, pageHistory(a.id), token));
    confirm(token => service.trash([d.id, recycled.id], workspaceHistory, token));
    const preview = purge.purge([d.id]);
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") assert.deepEqual(preview.pages.map(page => page.id), [d.id]);
    erase(purge, [d.id]);
    assert.equal(service.blockRow(parent.id), null);
    assert.equal(service.blockRow(child.id), null);
    assert.ok(service.get(recycled.id).blocks[recycled.children[0]]);
    assert.equal(history.state(pageHistory(a.id)).canUndo, true);
    assert.equal(service.statement("SELECT target_id FROM link_refs WHERE source_kind='block' AND source_id=?").pluck().get(a.titleBlockId), parent.id);
    assert.equal(service.resolve({ kind: "block", id: parent.id })?.status, "deleted");
    assert.deepEqual(service.sql.pragma("foreign_key_check"), []);
});

test("reopening collects removed blocks and rootless cycles while keeping live and recycled trees", t => {
    const { service, database, info } = fixture(t), a = service.create("editable", "A"), recycled = service.create("editable", "Recycled");
    const removed = a.children[0], left = randomUUID(), right = randomUUID();
    confirm(token => service.deleteBlock({ pageId: a.id, blockId: removed }, pageHistory(a.id), token));
    confirm(token => service.trash([recycled.id], workspaceHistory, token));
    database.transaction(() => {
        const insert = database.prepare("INSERT INTO blocks(id,type,children) VALUES (?,'paragraph',?)");
        insert.run(left, JSON.stringify([right])); insert.run(right, JSON.stringify([left]));
    })();
    assert.ok(service.blockRow(removed));
    session.close();
    const reopened = openWorkspace(info.path); t.after(() => session.close());
    const current = knowledgeServices();
    for (const id of [removed, left, right]) assert.equal(current.blockRow(id), null);
    assert.equal(current.get(a.id).title, "A");
    assert.ok(current.get(recycled.id).blocks[recycled.children[0]]);
    assert.deepEqual(reopened.database.pragma("foreign_key_check"), []);
});

test("collecting orphan blocks discards dependent history and preserves unrelated page edits", t => {
    const { service, history, purge } = fixture(t), a = service.create("editable", "A"), b = service.create("editable", "B");
    service.commitEdit({ pageId: b.id, batch: 0, blocks: [], attributes: { pinned: true } }, pageHistory(b.id));
    confirm(token => service.deleteBlock({ pageId: a.id, blockId: a.children[0] }, pageHistory(a.id), token));
    assert.equal(history.state(pageHistory(a.id)).canUndo, true);
    assert.equal(history.state(pageHistory(b.id)).canUndo, true);
    const result = purge.purge(null);
    assert.equal(result.status, "deleted");
    if (result.status === "deleted") {
        assert.deepEqual(result.pages, []);
        assert.deepEqual(result.blocks, [a.children[0]]);
    }
    assert.equal(history.state(pageHistory(a.id)).canUndo, false);
    assert.equal(history.state(pageHistory(b.id)).canUndo, true);
    assert.equal(service.get(b.id).attributes.pinned, true);
});

test("a changed recycle set invalidates a previously confirmed empty-trash scope", t => {
    const { service, purge } = fixture(t), a = service.create("editable", "A"), b = service.create("editable", "B");
    confirm(token => service.trash([a.id], workspaceHistory, token));
    const first = purge.purge(null);
    assert.equal(first.status, "confirmation");
    if (first.status !== "confirmation") return;
    confirm(token => service.trash([b.id], workspaceHistory, token));
    const next = purge.purge(null, first.token);
    assert.equal(next.status, "confirmation");
    assert.equal(service.list({ deleted: true }).total, 2);
});
async function annotated(t: TestContext): Promise<ReturnType<typeof fixture> & { id: string; annotation: string; file: string; path: string }> {
    const f = fixture(t), path = join(f.info.path, "paper.pdf");
    writeFileSync(path, knownCoordinatePdf());
    const id = (await f.papers.importFile(path)).pageId, file = (await f.papers.resources(id)).files[0];
    const annotation = await f.papers.annotate(id, { fileId: file.id, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "", context: "", extractorVersion: PDF_EXTRACTOR_VERSION }, pageHistory(id));
    const stored = f.database.prepare("SELECT stored_name FROM attachments WHERE id=?").pluck().get(file.id) as string;
    return { ...f, id, annotation, file: join(f.info.path, "attachments", stored), path };
}
test("purging a paper removes its solely retained annotation pages, PDF bytes and timers", async t => {
    const { service, purge, id, annotation, file } = await annotated(t);
    service.timers.set(id, "created_at", 0, true);
    confirm(token => service.trash([id], workspaceHistory, token));
    assert.equal(service.flags(annotation).deleted, true);
    const preview = purge.purge([id], "paper");
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") assert.deepEqual(new Set(preview.pages.map(page => page.id)), new Set([id, annotation]));
    assert.deepEqual(new Set(erase(purge, [id])), new Set([id, annotation]));
    assert.equal(existsSync(file), false);
    for (const table of ["attachments", "timers"]) assert.equal(service.sql.prepare("SELECT count(*) FROM " + table).pluck().get(), 0, table);
});
test("another live or recycled paper retains an annotation and the immutable attachment it still needs", async t => {
    const { service, purge, id, annotation, file } = await annotated(t);
    const other = service.create("paper", "B");
    service.commitEdit({ pageId: other.id, batch: 1, blocks: [], attributes: { links: [annotation] } }, pageHistory(other.id));
    confirm(token => service.trash([id, other.id], workspaceHistory, token));
    assert.equal(service.flags(annotation).deleted, true);
    assert.deepEqual(erase(purge, [id]), [id]);
    assert.equal(service.get(annotation).kind, "annotation");
    assert.equal(existsSync(file), true);
    assert.deepEqual(new Set(erase(purge, [other.id])), new Set([other.id, annotation]));
    assert.equal(existsSync(file), false);
});
test("a dependent page in the recycle bin can retain a downstream page during permanent deletion", t => {
    const { service, purge } = fixture(t);
    const a = service.create("editable", "Selected"), outside = service.create("editable", "Other parent");
    const target = service.create("editable", "Keep", {}, a.id);
    const remaining = service.create("editable", "Non-independent owner", { links: [target.id] }, outside.id);
    confirm(token => service.trash([outside.id, a.id], workspaceHistory, token));
    assert.equal(service.get(remaining.id).attributes.independent, false);
    assert.equal(service.get(remaining.id).attributes.deleted, true);
    assert.deepEqual(erase(purge, [a.id]), [a.id]);
    assert.equal(service.get(target.id).attributes.deleted, true);
    assert.deepEqual(new Set(erase(purge, null)), new Set([outside.id, remaining.id, target.id]));
});

test("a surviving annotation retains its contents and can identify its permanently deleted original", async t => {
    const { service, purge, papers, id, annotation } = await annotated(t);
    const retained = service.create("editable", "Keeps the annotation", { links: [annotation] });
    const page = service.get(annotation), body = page.blocks[page.children[0]];
    service.commitEdit({ pageId: annotation, batch: 0, blocks: [{ ...body, payload: payload("paragraph", "Keep this note") }] }, pageHistory(annotation));
    const before = service.get(annotation);
    const owner = { id, title: service.get(id).title, recycled: false };
    assert.deepEqual(papers.annotationPaper(annotation), owner);
    assert.equal(Object.hasOwn(before.attributes, "annotation_paper"), false);
    confirm(token => service.trash([id], workspaceHistory, token));
    assert.deepEqual(papers.annotationPaper(annotation), { ...owner, recycled: true });
    assert.deepEqual(service.backlinks(annotation).map(row => row.sourceId), [retained.id]);
    assert.deepEqual(erase(purge, [id]), [id]);
    const after = await papers.get(annotation);
    assert.deepEqual(after.blocks, before.blocks);
    assert.deepEqual(after.attributes, before.attributes);
    assert.equal(papers.annotationPaper(annotation), null);
    assert.equal(service.resolve({ kind: "page", id }), null);
    assert.deepEqual(service.backlinks(annotation).map(row => row.sourceId), [retained.id]);
});
test("purging one paper deletes only its independent copy of an identically imported PDF", async t => {
    const { service, purge, papers, info } = fixture(t), path = join(info.path, "shared.pdf");
    writeFileSync(path, knownCoordinatePdf());
    const a = (await papers.importFile(path)).pageId, b = (await papers.importFile(path)).pageId;
    const first = papers.externalPath((await papers.resources(a)).files[0].id), second = papers.externalPath((await papers.resources(b)).files[0].id);
    confirm(token => service.trash([a, b], workspaceHistory, token));
    erase(purge, [a]); assert.equal(existsSync(first), false); assert.equal(existsSync(second), true);
    erase(purge, [b]); assert.equal(existsSync(second), false);
});
test("purging an annotation's paper removes its PDF and removes the highlight history", async t => {
    const { service, history, purge, papers, info } = fixture(t), path = join(info.path, "plain.pdf");
    writeFileSync(path, knownCoordinatePdf());
    const page = (await papers.importFile(path)).pageId, fileId = (await papers.resources(page)).files[0].id;
    await papers.annotate(page, { fileId, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "", context: "", extractorVersion: PDF_EXTRACTOR_VERSION }, pageHistory(page), "yellow");
    const mark = (await papers.resources(page)).annotations[0];
    confirm(token => papers.deleteAnnotation(mark.id, pageHistory(mark.id), token));
    assert.equal(history.state(pageHistory(page)).canUndo, true);
    confirm(token => service.trash([page], workspaceHistory, token));
    erase(purge, [page]);
    assert.equal(history.state(pageHistory(page)).canUndo, false);
    assert.equal(service.sql.prepare("SELECT count(*) FROM attachments").pluck().get(), 0);
});

test("a failed permanent deletion rolls back rows and keeps every page's history", async t => {
    const { service, history, purge, id, file } = await annotated(t);
    const other = service.create("editable", "B");
    service.commitEdit({ pageId: other.id, batch: 1, blocks: [], attributes: { pinned: true } }, pageHistory(other.id));
    confirm(token => service.trash([id], workspaceHistory, token));
    service.sql.prepare("UPDATE attachments SET stored_name='../invalid.pdf'").run();
    const before = history.state(pageHistory(other.id)), trash = history.state(workspaceHistory);
    const preview = purge.purge([id]);
    assert.equal(preview.status, "confirmation");
    if (preview.status !== "confirmation") throw new Error("Expected confirmation");
    assert.throws(() => purge.purge([id], preview.token), hasFailure("attachment-invalid-name"));
    assert.equal(service.get(id).attributes.deleted, true);
    assert.equal(existsSync(file), true);
    assert.deepEqual(history.state(pageHistory(other.id)), before);
    assert.deepEqual(history.state(workspaceHistory), trash);
});
test("menus and shortcut dispatch use the same table, respect editor handling and ignore composing input", () => {
    const event = (key: string, overrides = {}): Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing" | "keyCode" | "defaultPrevented"> => ({ key, keyCode: 0, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, isComposing: false, defaultPrevented: false, ...overrides });
    for (const [id, definition] of Object.entries(commands)) {
        if (!definition.shortcut) continue;
        const parts = definition.shortcut.split("+"), key = parts.at(-1)!;
        assert.equal(shortcutCommand(event(key, { ctrlKey: parts.includes("Ctrl"), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift") })), id);
        assert.equal(shortcutCommand(event(key, { isComposing: true })), undefined);
        assert.equal(shortcutCommand(event(key, { keyCode: 229 })), undefined);
    }
    assert.equal(shortcutCommand(event("b")), undefined);
    assert.equal(shortcutCommand(event("n", { defaultPrevented: true })), undefined);
    assert.equal(shortcutCommand(event("n", { isComposing: true })), undefined);
    const zh = createI18n("zh-CN"), en = createI18n("en");
    assert.deepEqual(menus.map(menu => zh.t(`menu.${menu.id}`)), ["文件", "编辑", "视图", "前往", "帮助"]);
    assert.deepEqual(menus.map(menu => en.t(`menu.${menu.id}`)), ["File", "Edit", "View", "Go", "Help"]);
    const items = menus.flatMap<Command>(menu => [...menu.items]);
    for (const id of ["attributes", "mergeGroup", "commandPalette"] as const) assert.ok(items.includes(id));
    for (const id of items) for (const language of ["zh-CN", "en"]) assert.ok(en.getResource(language, "translation", `command.${id}`));
});