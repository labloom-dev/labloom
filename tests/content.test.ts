import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { EditHistory } from "../main/knowledge/history";
import { fingerprint } from "../main/knowledge/attributes";
import { AppStorage } from "../main/storage/app";
import { builtinAttrs, builtinAttrsByPageKind } from "../shared/attrs/builtins";
import { display } from "../shared/attrs/format";
import { validateValue } from "../shared/attrs/values";
import { pageKinds } from "../shared/types/content";
import { confirmationText } from "../shared/content/confirmation";
import { payload, blockText } from "../shared/content/blocks";
import { type ContentBlock, type EditCommit, type CommitResult, type PageRecord } from "../shared/types/content";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { service: KnowledgeService; history: EditHistory } {
    const root = process.env.LABLOOM_TEST_ROOT;
    if (!root) throw new Error("Use the isolated workspace test runner.");
    const workspace = createWorkspace(mkdtempSync(join(root, "content-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const service = new KnowledgeService(workspace.db), history = new EditHistory(service);
    return { ...workspace, service, history };
}
function edit(service: KnowledgeService, page: PageRecord, changes: ContentBlock[], children = page.children, tabId = "tab-one"): CommitResult {
    return service.commitEdit({ pageId: page.id, tabId, batch: 1, pageChildren: children, blocks: changes });
}
function text(block: ContentBlock, value: string): ContentBlock {
    return { ...block, payload: payload(block.type, value) };
}
function snapshot(service: KnowledgeService): string {
    return fingerprint(["pages", "blocks", "page_attrs", "link_refs"].map(table => service.sql.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()));
}

test("repeated and nested UUIDs remain shared; edits update only their page context timestamp", t => {
    const { service } = fixture(t);
    let first = service.create("editable", "First"), second = service.create("editable", "Second");
    const shared = text(first.blocks[first.children[0]], "Shared");
    const child = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "Child"), children: [] };
    shared.children = [child.id, child.id];
    assert.equal(edit(service, first, [shared, child], [shared.id, shared.id]).status, "saved");
    second = service.get(second.id);
    assert.equal(edit(service, second, [], [shared.id]).status, "saved");
    const before = Date.UTC(2000, 0, 1) / 1000;
    service.attributes.write(first.id, { modified_at: before }, true);
    service.attributes.write(second.id, { modified_at: before }, true);
    first = service.get(first.id);
    assert.equal(edit(service, first, [text(first.blocks[child.id], "Updated")]).status, "saved");
    const saved = service.get(first.id);
    assert.deepEqual(saved.children, [shared.id, shared.id]);
    assert.deepEqual(saved.blocks[shared.id].children, [child.id, child.id]);
    assert.equal(blockText(service.get(second.id).blocks[child.id]), "Updated");
    assert.notEqual(saved.attributes.modified_at, before);
    assert.equal(service.get(second.id).attributes.modified_at, before);
    assert.deepEqual(service.backlinks(second.id), []);
});

test("opening current targetless references and rejecting malformed content never rewrites blocks", t => {
    const { service, database } = fixture(t);
    const page = service.create();
    const id = page.children[0];
    const content = JSON.stringify({ ...payload("blocked_reference", "Original reference"), target: null });
    const update = database.prepare("UPDATE blocks SET type = 'blocked_reference', content = ? WHERE id = ?");
    update.run(content, id);
    const opened = service.get(page.id);
    assert.equal(opened.blocks[id].payload.target, null);
    assert.equal(blockText(opened.blocks[id]), "Original reference");
    assert.deepEqual(service.backlinks(page.id), []);
    assert.equal(database.prepare("SELECT content FROM blocks WHERE id = ?").pluck().get(id), content);
    update.run("Original reference", id);
    assert.throws(() => service.get(page.id), SyntaxError);
    assert.equal(database.prepare("SELECT content FROM blocks WHERE id = ?").pluck().get(id), "Original reference");
});

test("unlinking shallow-copies one occurrence and retains all child UUIDs", t => {
    const { service } = fixture(t);
    let page = service.create();
    const parent = page.blocks[page.children[0]], child = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "Child"), children: [] };
    parent.children = [child.id];
    edit(service, page, [parent, child], [parent.id, parent.id]);
    page = service.get(page.id);
    service.place({ action: "clone", tabId: "tab-one", position: { pageId: page.id, containerId: page.id, index: 1, blockId: parent.id } });
    const result = service.get(page.id), copy = result.children[1];
    assert.notEqual(copy, parent.id);
    assert.equal(result.children[0], parent.id);
    assert.deepEqual(result.blocks[copy].children, [child.id]);
    assert.equal(Object.keys(result.blocks).length, 4);
    edit(service, result, [text(result.blocks[child.id], "Still shared")]);
    assert.deepEqual(service.get(page.id).blocks[parent.id].children, service.get(page.id).blocks[copy].children);
});

test("removing one occurrence never garbage-collects content, and stale positions fail", t => {
    const { service } = fixture(t);
    let page = service.create();
    const id = page.children[0];
    edit(service, page, [], [id, id]);
    page = service.get(page.id);
    const position = { pageId: page.id, containerId: page.id, index: 1, blockId: id };
    service.place({ action: "remove", tabId: "tab-one", position });
    assert.deepEqual(service.get(page.id).children, [id]);
    assert.throws(() => service.place({ action: "remove", tabId: "tab-one", position }), hasFailure("block-position-changed"));
    page = service.get(page.id);
    service.place({ action: "remove", tabId: "tab-one", position: { ...position, index: 0 } });
    assert.ok(service.blockRow(id));
});

test("shared edits need no version and invalid duplicate records or containment cycles roll back", t => {
    const { service } = fixture(t);
    const page = service.create(), initial = page.blocks[page.children[0]];
    edit(service, page, [text(initial, "Fresh")]);
    assert.equal(edit(service, page, [text(initial, "Later")]).status, "saved");
    const current = service.get(page.id), before = snapshot(service);
    assert.throws(() => edit(service, current, [{ ...current.blocks[initial.id], children: [initial.id] }]), hasFailure("block-cycle"));
    assert.equal(snapshot(service), before);
    assert.throws(() => edit(service, current, [current.blocks[initial.id], current.blocks[initial.id]]), hasFailure("edit-duplicate-block"));
    assert.equal(snapshot(service), before);
});

test("library refresh reorders results without hydrating unchanged summaries, and calendar reads only changed tasks", t => {
    const { service } = fixture(t);
    const a = service.create("task", "A"), b = service.create("task", "B"), c = service.create("event", "C");
    const query = { kind: "task" as const, sort: "title" as const };
    const updated = service.listUpdates(query, [b.id]);
    assert.deepEqual(updated.order, [a.id, b.id]);
    assert.deepEqual(updated.items.map(row => row.id), [a.id]);
    assert.equal(updated.total, 2);
    const renamed = edit(service, a, [text(a.blocks[a.titleBlockId], "Z")]);
    assert.equal(renamed.status, "saved");
    assert.deepEqual(service.listUpdates(query, [b.id]).order, [b.id, a.id]);
    assert.deepEqual(service.list({ ids: [a.id, c.id], kind: "task" }).items.map(row => row.id), [a.id]);
    assert.deepEqual(service.list({ ids: [] }), { total: 0, items: [] });
});

test("reference cycles lose retention together and only after the complete preview is confirmed", t => {
    const { service, database } = fixture(t);
    const root = service.create("editable", "Root");
    const a = service.create("editable", "A", { independent: false }, root.id);
    const b = service.create("editable", "B", { independent: false }, a.id);
    const backward = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id: a.id } }, children: [] };
    edit(service, b, [backward], [backward.id]);
    const before = snapshot(service), timestamp = database.prepare("SELECT last_modified_at FROM workspace_meta").get();
    const trash = (token?: string): CommitResult => service.trash([root.id], "tab-one", token);
    const pending = trash();
    assert.equal(pending.status, "confirmation");
    if (pending.status !== "confirmation") return;
    assert.deepEqual(new Set(pending.preview.recycled.map(page => page.id)), new Set([a.id, b.id]));
    assert.equal(snapshot(service), before);
    assert.deepEqual(database.prepare("SELECT last_modified_at FROM workspace_meta").get(), timestamp);
    trash(pending.preview.token);
    assert.equal(service.get(root.id).attributes.recycle_reason, "manual_delete");
    assert.equal(service.get(a.id).attributes.recycle_reason, "unreachable");
    assert.equal(service.get(b.id).attributes.deleted, true);
    service.restore([a.id, b.id], "tab-one");
    assert.equal(service.get(a.id).attributes.independent, true);
    assert.equal(service.get(a.id).attributes.recycled_at, null);
});

test("a reference to a shared block does not retain every page using that block", t => {
    const { service } = fixture(t);
    const root = service.create("editable", "Root"), child = service.create("editable", "Non-root", { independent: false }, root.id);
    const blockId = child.children[0], current = service.get(root.id);
    const reference = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "block" as const, id: blockId } }, children: [] };
    const input: EditCommit = { pageId: root.id, tabId: "tab-one", batch: 1, pageChildren: [reference.id], blocks: [reference] };
    const result = service.commitEdit(input);
    assert.equal(result.status, "confirmation");
    if (result.status !== "confirmation") return;
    assert.deepEqual(result.preview.recycled.map(page => page.id), [child.id]);
    service.commitEdit(input, result.preview.token);
    assert.ok(service.blockRow(blockId));
    assert.equal(service.get(root.id).attributes.deleted, false);
});

test("a stale lifecycle confirmation cannot silently cover a changed graph", t => {
    const { service } = fixture(t);
    const root = service.create("editable", "Root");
    const trash = (token?: string): CommitResult => service.trash([root.id], "tab-one", token);
    const preview = trash();
    assert.equal(preview.status, "confirmation");
    if (preview.status !== "confirmation") return;
    const dependent = service.create("editable", "New dependent", { independent: false }, root.id);
    const next = trash(preview.preview.token);
    assert.equal(next.status, "confirmation");
    assert.equal(service.get(root.id).attributes.deleted, false);
    assert.equal(service.get(dependent.id).attributes.deleted, false);
});

test("removing a retaining property previews both its owners and dependent pages atomically", t => {
    const { service, history } = fixture(t);
    const root = service.create("editable", "Owner");
    const dependent = service.create("editable", "Dependent");
    const id = `custom:${randomUUID()}`;
    const tabId = randomUUID();
    service.setDefinition(id, { id, type: "page-link", name: "Citation", metadata: {  } }, tabId);
    service.commitEdit({ pageId: root.id, tabId: "owner", batch: 1, blocks: [], attributes: { [id]: dependent.id } });
    service.commitEdit({ pageId: dependent.id, tabId: "dependent", batch: 1, blocks: [], attributes: { independent: false } });
    const preview = service.setDefinition(id, null, tabId)!;
    assert.deepEqual(preview.pages.map(page => page.id), [root.id]);
    assert.deepEqual(preview.recycled?.map(page => page.id), [dependent.id]);
    assert.equal(service.get(root.id).attributes[id], dependent.id);
    assert.equal(service.get(dependent.id).attributes.deleted, false);
    assert.equal(history.state("owner").canUndo, true);
    service.create("editable", "Another edit");
    let source: string | undefined;
    service.onChanged = change => {
        source = change.sourceTab;
    };
    assert.equal(service.setDefinition(id, null, tabId, preview.token), null);
    assert.equal(source, tabId);
    assert.equal(history.state(tabId).canUndo, false);
    assert.equal(Object.hasOwn(service.get(root.id).attributes, id), false);
    assert.equal(service.get(dependent.id).attributes.recycle_reason, "unreachable");
    assert.equal(history.state("owner").canUndo, false);
});

test("cross-tab history invalidates only overlapping operations and preserves redo branches", t => {
    const { service, history, database, info } = fixture(t);
    let page = service.create();
    const a = page.blocks[page.children[0]], b = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "B"), children: [] };
    edit(service, page, [b], [a.id, b.id], "setup");
    page = service.get(page.id);
    edit(service, page, [text(page.blocks[a.id], "A1")]);
    page = service.get(page.id);
    edit(service, page, [text(page.blocks[b.id], "B1")]);
    page = service.get(page.id);
    edit(service, page, [text(page.blocks[a.id], "A2")], page.children, "tab-two");
    assert.equal(history.state("tab-one").canUndo, true);
    history.apply("tab-one", "undo");
    assert.equal(blockText(service.get(page.id).blocks[a.id]), "A2");
    assert.equal(blockText(service.get(page.id).blocks[b.id]), "B");
    const firstBranch = history.state("tab-one").redo[0].id;
    page = service.get(page.id);
    edit(service, page, [text(page.blocks[b.id], "B alternate")]);
    history.apply("tab-one", "undo");
    assert.equal(history.state("tab-one").redo.length, 2);
    history.apply("tab-one", "redo", firstBranch);
    assert.equal(blockText(service.get(page.id).blocks[b.id]), "B1");
    database.close();
    const reopened = openWorkspace(info.path);
    t.after(() => reopened.database.close());
    const restoredHistory = new EditHistory(new KnowledgeService(reopened.db));
    assert.equal(restoredHistory.state("tab-one").canUndo, false);
    restoredHistory.close("tab-one");
    assert.equal(restoredHistory.state("tab-one").canUndo, false);
});

test("deleteBlock removes every use, keeps live links and undo restores nested and repeated positions", t => {
    const { service, history } = fixture(t);
    const a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
    const shared = text(a.blocks[a.children[0]], "Common");
    const parent = { ...b.blocks[b.children[0]], children: [shared.id] };
    const link = { ...c.blocks[c.children[0]], payload: { ...payload("paragraph"), inline: [
        { type: "inlineReference" as const, attrs: { target: { kind: "block" as const, id: shared.id }, label: "Common" } }
    ] } };
    edit(service, a, [shared], [shared.id, shared.id]);
    edit(service, b, [parent]);
    edit(service, c, [link]);
    const target = { kind: "block" as const, id: shared.id };
    const remove = (token?: string): CommitResult => service.deleteBlock({ pageId: a.id, tabId: "delete", blockId: shared.id }, token);
    const pending = remove();
    assert.equal(pending.status, "confirmation");
    assert.equal(confirmationText(pending.preview), "“Common”将从2个页面的3个位置消失，1个链接引用将显示“已删除”。");
    assert.equal(service.uses(shared.id).length, 3);
    assert.equal(remove(pending.preview.token).status, "saved");
    assert.deepEqual(service.get(a.id).children, []);
    assert.deepEqual(service.get(b.id).blocks[parent.id].children, []);
    assert.ok(service.blockRow(shared.id));
    assert.deepEqual(service.get(c.id).blocks[link.id].payload, link.payload);
    assert.equal(service.resolve(target)?.status, "deleted");
    assert.equal(history.apply("delete", "undo").status, "saved");
    assert.equal(service.resolve(target)?.status, "ok");
    assert.deepEqual(service.get(a.id).children, [shared.id, shared.id]);
    assert.deepEqual(service.get(b.id).blocks[parent.id].children, [shared.id]);
});

test("reference deletion names its target, omits zero counts and lists all recycled pages once", t => {
    const { service } = fixture(t);
    const d = service.create("editable", "D");
    const e = service.create("editable", "E", { independent: false }, d.id);
    const f = service.create("editable", "F", { independent: false }, e.id);
    const blockId = service.get(d.id).children.at(-1)!;
    const remove = (token?: string): CommitResult => service.deleteBlock({ pageId: d.id, tabId: "delete", blockId }, token);
    const result = remove();
    assert.equal(result.status, "confirmation");
    assert.equal(confirmationText(result.preview), "指向「E」的链接引用将从1个页面的1个位置消失。\n将移入回收站：E、F。");
    assert.equal(remove(result.preview.token).status, "saved");
    for (const page of [e, f]) assert.equal(service.get(page.id).attributes.deleted, true);
});

test("incremental links match rebuilding after changing, clearing and undoing all three link sources", t => {
    const { service, history } = fixture(t);
    const a = service.create(), b = service.create();
    const read = (): unknown[] => service.sql.prepare("SELECT * FROM link_refs ORDER BY source_kind,source_id,source_field,target_kind,target_id").all();
    const check = (count: number): void => {
        const before = read();
        assert.equal(before.length, count);
        service.rebuildLinks();
        assert.deepEqual(read(), before);
    };
    const reference = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id: b.id } }, children: [] };
    const target = { kind: "block" as const, id: b.children[0] };
    const inline = { type: "inlineReference" as const, attrs: { target, label: "B" } };
    const body = { ...a.blocks[a.children[0]], payload: { ...payload("paragraph"), inline: [inline, inline] } };
    const batch = { pageId: a.id, tabId: "links", batch: 1, blocks: [reference, body], pageChildren: [body.id, reference.id], attributes: { links: [b.id] } };
    assert.equal(service.commitEdit(batch).status, "saved");
    check(3);
    assert.equal(service.commitEdit({ ...batch, blocks: [a.blocks[body.id], { ...reference, payload: { ...reference.payload, target: null } }], attributes: { links: [] } }).status, "saved");
    check(0);
    history.apply("links", "undo");
    check(3);
});

test("new pages have valid typed values, independent retention and system timestamps", t => {
    const { service } = fixture(t), parent = service.create("paper");
    for (const kind of pageKinds) {
        const page = service.create(kind, kind, {}, kind === "annotation" ? parent.id : undefined);
        assert.deepEqual(Object.keys(page.attributes).sort(), [...builtinAttrsByPageKind[kind]].sort());
        for (const id of builtinAttrsByPageKind[kind]) validateValue({ id, ...builtinAttrs[id] }, page.attributes[id]);
        assert.equal(page.attributes.independent, kind !== "annotation");
        assert.deepEqual(page.attributes.links, []);
        assert.ok(Number.isSafeInteger(page.attributes.created_at) && Number.isSafeInteger(page.attributes.modified_at));
        if (kind === "task") {
            assert.equal(page.attributes.task_status, "todo");
            assert.equal(page.attributes.priority, "normal");
            assert.equal(service.commitEdit({ pageId: page.id, tabId: "status", batch: 1, blocks: [], attributes: { task_status: null, priority: null } }).status, "saved");
            assert.equal(service.get(page.id).attributes.task_status, null);
            assert.equal(service.get(page.id).attributes.priority, null);
        }
    }
});

test("keywords and display use the current application timezone on the same open workspace", t => {
    const { db, info } = fixture(t);
    const storage = new AppStorage(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "preferences-")));
    storage.load();
    storage.remember(info);
    const service = new KnowledgeService(db, () => storage.getAppearance().timeZone);
    storage.saveAppearance({ ...storage.getAppearance(), timeZone: "Asia/Shanghai" });
    const e = service.create("event", "A");
    const anchor = randomUUID(), a = service.create("annotation", "B", { independent: true, annotation_context: anchor });
    assert.ok(!("task_status" in e.attributes) && !("priority" in e.attributes));
    const seconds = 1794071576;
    service.attributes.write(e.id, { created_at: seconds, modified_at: seconds + 3600, schedule_start: seconds + 7200 }, true);
    service.attributes.write(a.id, { created_at: 0, modified_at: 0 }, true);
    const created = (): string => display({ id: "created_at", ...builtinAttrs.created_at }, service.get(e.id).attributes.created_at, { zone: storage.getAppearance().timeZone });
    assert.equal(created(), "2026-11-08 01:12");
    for (const keyword of ["tags", "true", "modified", anchor, "1794", "17:12", "未开始", "asia"]) assert.equal(service.list({ keyword }).total, 0, keyword);
    for (const keyword of ["2026", "01:12", "02:12", "03:12"]) assert.deepEqual(service.list({ keyword }).items.map(p => p.id), [e.id], keyword);
    storage.saveAppearance({ ...storage.getAppearance(), timeZone: "UTC" });
    assert.equal(created(), "2026-11-07 17:12");
    assert.deepEqual(service.list({ keyword: "17:12" }).items.map(p => p.id), [e.id]);
    assert.equal(service.list({ keyword: "01:12" }).total, 0);
    const tag = randomUUID(), definition = service.attributes.definition("tags");
    service.setDefinition("tags", { ...definition, metadata: { ...definition.metadata, options: [{ id: tag, name: "Research" }] } }, randomUUID());
    service.commitEdit({ pageId: e.id, tabId: "edit", batch: 1, blocks: [], attributes: { tags: [tag] } });
    assert.equal(service.list({ keyword: tag }).total, 0);
    assert.equal(service.list({ keyword: "research" }).total, 1);
    const dt = service.statement("SELECT typeof(value) FROM page_attrs WHERE page_id=? AND attr_id=?").pluck();
    for (const id of ["created_at", "modified_at", "schedule_start"]) assert.equal(dt.get(e.id, id), "integer");
});