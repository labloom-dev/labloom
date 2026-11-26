import { pageHistory, workspaceHistory } from "./support/history";
import { watchKnowledge } from "./support/session";
import { knowledgeServices, historyServices, session, type Knowledge, type History } from "./support/session";
import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "./support/session";
import { fingerprint } from "../main/knowledge/attributes";
import { blockList } from "../main/knowledge/block-list";
import { trashIndex, viewIndex } from "../main/knowledge/query";
import { EditChanges } from "../main/knowledge/changes";
import * as settings from "../main/settings/store";
import { builtinAttrs, builtinAttrsByPageKind } from "../shared/attrs/builtins";
import { display } from "../shared/attrs/format";
import { dayToSeconds } from "../shared/content/time";
import { validateValue } from "../shared/attrs/values";
import { pageKinds } from "../shared/types/content";
import { confirmationText, recycledPageNames } from "../shared/content/confirmation";
import { payload, blockText } from "../shared/content/blocks";
import { type ContentBlock, type EditCommit, type CommitResult, type PageRecord } from "../shared/types/content";

function fixture(t: TestContext, options: import("../main/session").SessionOptions = {}): ReturnType<typeof createWorkspace> & { service: Knowledge; history: History } {
    const root = process.env.LABLOOM_TEST_ROOT;
    if (!root) throw new Error("Use the isolated workspace test runner.");
    const workspace = createWorkspace(mkdtempSync(join(root, "content-")), options);
    t.after(() => {
        session.close();
    });
    const service = knowledgeServices(), history = historyServices();
    return { ...workspace, service, history };
}
function edit(service: Knowledge, page: PageRecord, changes: ContentBlock[], children = page.children): CommitResult {
    return service.commitEdit({ pageId: page.id, batch: 1, pageChildren: children, blocks: changes }, pageHistory(page.id));
}
function text(block: ContentBlock, value: string): ContentBlock {
    return { ...block, payload: payload(block.type, value) };
}
function snapshot(service: Knowledge): string {
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
    service.place({ action: "clone", position: { pageId: page.id, containerId: page.id, index: 1, blockId: parent.id } }, pageHistory(page.id));
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
    service.place({ action: "remove", position }, pageHistory(position.pageId));
    assert.deepEqual(service.get(page.id).children, [id]);
    assert.throws(() => service.place({ action: "remove", position }, pageHistory(position.pageId)), hasFailure("block-position-changed"));
    page = service.get(page.id);
    service.place({ action: "remove", position: { ...position, index: 0 } }, pageHistory(position.pageId));
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

test("library refresh reorders results without hydrating unchanged summaries, and calendar reads only changed dated pages", t => {
    const { service } = fixture(t);
    const a = service.create("editable", "A", { schedule_date: 0 }), b = service.create("editable", "B", { schedule_date: 0 }), c = service.create("editable", "C");
    const query = { hasValue: "schedule_date", sort: "title" as const };
    const updated = service.listUpdates(query, [b.id]);
    assert.deepEqual(updated.order, [a.id, b.id]);
    assert.deepEqual(updated.items.map(row => row.id), [a.id]);
    assert.equal(updated.total, 2);
    const renamed = edit(service, a, [text(a.blocks[a.titleBlockId], "Z")]);
    assert.equal(renamed.status, "saved");
    assert.deepEqual(service.listUpdates(query, [b.id]).order, [b.id, a.id]);
    assert.deepEqual(service.list({ ids: [a.id, c.id], hasValue: "schedule_date" }).items.map(row => row.id), [a.id]);
    assert.deepEqual(service.list({ ids: [] }), { total: 0, items: [] });
});

test("recycled pages disappear from active listings, search, the picker and backlinks but remain resolvable", t => {
    const { service } = fixture(t);
    const note = service.create("editable", "Destination"), paper = service.create("paper", "Unique recycle filter", {
        pinned: true, schedule_date: 0, links: [note.id]
    });
    assert.equal(service.backlinks(note.id)[0].sourceId, paper.id);
    const result = service.trash([paper.id], workspaceHistory);
    assert.equal(result.status, "confirmation");
    service.trash([paper.id], workspaceHistory, result.preview.token);
    assert.deepEqual(service.backlinks(note.id), []);
    assert.equal(service.searchPages(paper.title).total, 0);
    assert.equal(service.list({ ids: [paper.id] }).total, 0);
    assert.equal(service.list({ pinned: true }).total, 0);
    assert.equal(service.list({ hasValue: "schedule_date" }).total, 0);
    assert.equal(service.list({ kind: "paper" }).total, 0);
    assert.throws(() => blockList(paper.id), hasFailure("page-recycled-readonly"));
    assert.deepEqual(viewIndex({ type: "library", language: "en", query: { conditions: [], sort: [] } }).ids, [note.id]);
    assert.deepEqual(trashIndex({ language: "en", sort: [] }).ids, [paper.id]);
    assert.equal(service.resolve({ kind: "page", id: paper.id })?.status, "recycled");
    service.restore([paper.id], workspaceHistory);
    assert.equal(service.backlinks(note.id)[0].sourceId, paper.id);
});

test("malformed block rows fail validation before body checks", t => {
    const { service } = fixture(t), page = service.create("paper", "Paper");
    const invalid = null as unknown as ContentBlock;
    assert.throws(() => new EditChanges().putBlock(invalid), hasFailure("block-invalid-identity"));
    assert.throws(() => service.commitEdit({ pageId: page.id, batch: 0, blocks: [invalid] }, pageHistory(page.id)), hasFailure("block-invalid-identity"));
});

test("a structural save writes once and a confirmation rolls back its attempted write", t => {
    const { service } = fixture(t);
    const parent = service.create("editable", "Parent"), child = service.create("editable", "Child", {}, parent.id);
    const stored = service.get(parent.id), source = pageHistory(parent.id);
    const added = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "New paragraph"), children: [] };
    const prototype = Object.getPrototypeOf(service.sql.prepare("SELECT 1"));
    const original = prototype.run;
    let writes = 0;
    t.mock.method(prototype, "run", function (this: { source: string }, ...args: unknown[]) {
        if (this.source.startsWith("UPDATE pages SET children=")) writes++;
        return original.apply(this, args);
    });
    const children = [...stored.children, added.id];
    assert.equal(service.commitEdit({ pageId: parent.id, batch: 1, blocks: [added], pageChildren: children }, source).status, "saved");
    assert.equal(writes, 1);

    const remove = { pageId: parent.id, batch: 2, blocks: [], pageChildren: parent.children };
    const pending = service.commitEdit(remove, source);
    assert.equal(pending.status, "confirmation");
    assert.deepEqual(pending.preview.recycled.map(page => page.id), [child.id]);
    assert.equal(writes, 2);
    assert.deepEqual(service.get(parent.id).children, children);
    assert.equal(service.get(child.id).attributes.deleted, false);
    assert.equal(service.commitEdit(remove, source, pending.preview.token).status, "saved");
    assert.equal(writes, 3);
    assert.equal(service.get(child.id).attributes.deleted, true);
});

test("reference cycles lose retention together and only after the complete preview is confirmed", t => {
    const { service, database } = fixture(t);
    const root = service.create("editable", "Root");
    const a = service.create("editable", "A", { independent: false }, root.id);
    const b = service.create("editable", "B", { independent: false }, a.id);
    const backward = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id: a.id } }, children: [] };
    edit(service, b, [backward], [backward.id]);
    const before = snapshot(service), timestamp = database.prepare("SELECT last_modified_at FROM workspace_meta").get();
    const trash = (token?: string): CommitResult => service.trash([root.id], workspaceHistory, token);
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
    service.restore([a.id, b.id], workspaceHistory);
    assert.equal(service.get(a.id).attributes.independent, true);
    assert.equal(service.get(a.id).attributes.recycled_at, null);
});

test("a reference to a shared block does not retain every page using that block", t => {
    const { service } = fixture(t);
    const root = service.create("editable", "Root"), child = service.create("editable", "Non-root", { independent: false }, root.id);
    const blockId = child.children[0], current = service.get(root.id);
    const reference = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "block" as const, id: blockId } }, children: [] };
    const input: EditCommit = { pageId: root.id, batch: 1, pageChildren: [reference.id], blocks: [reference] };
    const result = service.commitEdit(input, pageHistory(input.pageId));
    assert.equal(result.status, "confirmation");
    if (result.status !== "confirmation") return;
    assert.deepEqual(result.preview.recycled.map(page => page.id), [child.id]);
    service.commitEdit(input, pageHistory(input.pageId), result.preview.token);
    assert.ok(service.blockRow(blockId));
    assert.equal(service.get(root.id).attributes.deleted, false);
});

test("a stale lifecycle confirmation cannot silently cover a changed graph", t => {
    const { service } = fixture(t);
    const root = service.create("editable", "Root");
    const trash = (token?: string): CommitResult => service.trash([root.id], workspaceHistory, token);
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
    service.setDefinition(id, { id, type: "page-link", name: "Citation", metadata: {} });
    service.commitEdit({ pageId: root.id, batch: 1, blocks: [], attributes: { [id]: dependent.id } }, pageHistory(root.id));
    service.commitEdit({ pageId: dependent.id, batch: 1, blocks: [], attributes: { independent: false } }, pageHistory(dependent.id));
    const preview = service.setDefinition(id, null)!;
    assert.deepEqual(preview.pages.map(page => page.id), [root.id]);
    assert.deepEqual(preview.recycled?.map(page => page.id), [dependent.id]);
    assert.equal(service.get(root.id).attributes[id], dependent.id);
    assert.equal(service.get(dependent.id).attributes.deleted, false);
    assert.equal(history.state(pageHistory(root.id)).canUndo, true);
    service.create("editable", "Another edit");
    assert.equal(service.setDefinition(id, null, preview.token), null);
    assert.equal(history.state(workspaceHistory).canUndo, false);
    assert.equal(Object.hasOwn(service.get(root.id).attributes, id), false);
    assert.equal(service.get(dependent.id).attributes.recycle_reason, "unreachable");
    assert.equal(history.state(pageHistory(root.id)).canUndo, false);
});

test("a new edit after undo replaces the old redo step", t => {
    const { service, history, database, info } = fixture(t);
    let page = service.create();
    const a = page.blocks[page.children[0]], b = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "B"), children: [] };
    edit(service, page, [b], [a.id, b.id]);
    page = service.get(page.id);
    edit(service, page, [text(page.blocks[a.id], "A1")]);
    page = service.get(page.id);
    edit(service, page, [text(page.blocks[b.id], "B1")]);
    page = service.get(page.id);
    edit(service, page, [text(page.blocks[a.id], "A2")]);
    assert.equal(history.state(pageHistory(page.id)).canUndo, true);
    history.apply(pageHistory(page.id), "undo");
    assert.equal(blockText(service.get(page.id).blocks[a.id]), "A1");
    assert.equal(blockText(service.get(page.id).blocks[b.id]), "B1");
    assert.equal(history.state(pageHistory(page.id)).canRedo, true);
    page = service.get(page.id);
    edit(service, page, [text(page.blocks[b.id], "B alternate")]);
    assert.equal(history.state(pageHistory(page.id)).canRedo, false);
    history.apply(pageHistory(page.id), "undo");
    assert.equal(history.state(pageHistory(page.id)).canRedo, true);
    history.apply(pageHistory(page.id), "redo");
    assert.equal(blockText(service.get(page.id).blocks[b.id]), "B alternate");
    session.close();
    const reopened = openWorkspace(info.path);
    t.after(() => session.close());
    const restoredHistory = historyServices();
    assert.equal(restoredHistory.state(pageHistory(page.id)).canUndo, false);
    assert.equal(blockText(service.get(page.id).blocks[a.id]), "A1");
});

test("one block-menu deletion and one undo cover every selected block and repeated occurrence", t => {
    const { service, history } = fixture(t);
    const page = service.create("editable", "Bulk deletion"), another = service.create("editable", "Mirror");
    const first = page.children[0], second = randomUUID();
    const children = [first, second, first];
    edit(service, page, [{ id: second, type: "paragraph", payload: payload("paragraph", "B"), children: [] }], children);
    edit(service, another, [], [second, first]);
    const remove = (token?: string): CommitResult => service.deleteBlock({ pageId: page.id, blockIds: [first, second, first] }, pageHistory(page.id), token);
    const pending = remove();
    assert.equal(pending.status, "confirmation");
    assert.equal(pending.preview.deletedBlocks.length, 2);
    assert.deepEqual(service.get(page.id).children, children);
    assert.equal(remove(pending.preview.token).status, "saved");
    assert.deepEqual(service.get(page.id).children, []);
    assert.deepEqual(service.get(another.id).children, []);
    history.apply(pageHistory(page.id), "undo");
    assert.deepEqual(service.get(page.id).children, children);
    assert.deepEqual(service.get(another.id).children, [second, first]);
});

test("deleteBlock removes every use, keeps live links and undo restores nested and repeated positions", t => {
    const { service, history } = fixture(t);
    const a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
    const shared = text(a.blocks[a.children[0]], "Common");
    const parent = { ...b.blocks[b.children[0]], children: [shared.id] };
    const link = {
        ...c.blocks[c.children[0]], payload: {
            ...payload("paragraph"), inline: [
                { type: "inlineReference" as const, attrs: { target: { kind: "block" as const, id: shared.id }, label: "Common" } }
            ]
        }
    };
    edit(service, a, [shared], [shared.id, shared.id]);
    edit(service, b, [parent]);
    edit(service, c, [link]);
    const target = { kind: "block" as const, id: shared.id };
    const remove = (token?: string): CommitResult => service.deleteBlock({ pageId: a.id, blockId: shared.id }, pageHistory(a.id), token);
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
    assert.equal(history.apply(pageHistory(a.id), "undo").status, "saved");
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
    const remove = (token?: string): CommitResult => service.deleteBlock({ pageId: d.id, blockId }, pageHistory(d.id), token);
    const result = remove();
    assert.equal(result.status, "confirmation");
    assert.equal(confirmationText(result.preview), "指向「E」的链接引用将从1个页面的1个位置消失。\n将把2个页面移入回收站。");
    assert.deepEqual(recycledPageNames(result.preview), ["E", "F"]);
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
    const batch = { pageId: a.id, batch: 1, blocks: [reference, body], pageChildren: [body.id, reference.id], attributes: { links: [b.id] } };
    assert.equal(service.commitEdit(batch, pageHistory(batch.pageId)).status, "saved");
    check(3);
    assert.equal(service.commitEdit({ ...batch, blocks: [a.blocks[body.id], { ...reference, payload: { ...reference.payload, target: null } }], attributes: { links: [] } }, pageHistory(batch.pageId)).status, "saved");
    check(0);
    history.apply(pageHistory(a.id), "undo");
    check(3);
});

test("detaching and deleting custom page links clears their source index through the service", t => {
    const { service } = fixture(t), a = service.create("editable", "A"), b = service.create("editable", "B");
    const id = "custom:" + randomUUID(), definition = { id, type: "page-link" as const, name: "Related", metadata: {} };
    assert.equal(service.setDefinition(id, definition), null);
    const count = (): unknown => service.statement("SELECT count(*) FROM link_refs WHERE source_kind='page' AND source_field=?").pluck().get(id);
    service.commitEdit({ pageId: a.id, batch: 0, blocks: [], attributes: { [id]: b.id } }, pageHistory(a.id));
    assert.equal(count(), 1);
    service.commitEdit({ pageId: a.id, batch: 1, blocks: [], detach: [id] }, pageHistory(a.id));
    assert.equal(count(), 0);
    service.commitEdit({ pageId: a.id, batch: 2, blocks: [], attributes: { [id]: b.id } }, pageHistory(a.id));
    const preview = service.setDefinition(id, null);
    assert.ok(preview);
    assert.equal(service.setDefinition(id, null, preview.token), null);
    assert.equal(count(), 0);
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
    }
});

test("keywords and display use the current application timezone on the same open workspace", t => {
    settings.initialize(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "preferences-")));
    fixture(t);
    const service = knowledgeServices();
    settings.update({ appearance: { timeZone: "Asia/Shanghai" } });
    const e = service.create("editable", "A");
    const anchor = randomUUID(), a = service.create("annotation", "B", { independent: true, annotation_context: anchor });
    assert.ok(!("task_status" in e.attributes) && !("priority" in e.attributes));
    const seconds = 1794071576;
    service.attributes.write(e.id, { created_at: seconds, modified_at: seconds + 3600, schedule_start: seconds + 7200 }, true);
    service.attributes.write(a.id, { created_at: 0, modified_at: 0 }, true);
    const timestamp = (id: "created_at" | "modified_at"): string => display({ id, ...builtinAttrs[id] }, service.get(e.id).attributes[id], { zone: settings.get().settings.appearance.timeZone });
    assert.equal(timestamp("created_at"), "2026-11-08 01:12");
    assert.equal(timestamp("modified_at"), "2026-11-08 02:12");
    for (const keyword of ["tags", "true", "modified", anchor, "1794", "01:12", "02:12", "17:12", "未开始", "asia"]) assert.equal(service.list({ keyword }).total, 0, keyword);
    for (const keyword of ["2026", "03:12"]) assert.deepEqual(service.list({ keyword }).items.map(p => p.id), [e.id], keyword);
    settings.update({ appearance: { timeZone: "UTC" } });
    assert.equal(timestamp("created_at"), "2026-11-07 17:12");
    assert.equal(timestamp("modified_at"), "2026-11-07 18:12");
    for (const keyword of ["17:12", "18:12", "03:12"]) {
        assert.equal(service.list({ keyword }).total, 0, keyword);
        assert.equal(service.searchPages(keyword).total, 0, keyword);
    }
    assert.deepEqual(service.searchPages("19:12").items[0].match, { field: "attribute", id: "schedule_start", name: "开始时间", snippet: "2026-11-07 19:12" });

    const experimentDay = "custom:" + randomUUID();
    service.setDefinition(experimentDay, { id: experimentDay, name: "实验日期", type: "day", metadata: {} });
    service.attributes.write(a.id, { [experimentDay]: dayToSeconds("2026-11-20") });
    assert.deepEqual(service.list({ keyword: "2026-11-20" }).items.map(page => page.id), [a.id]);
    assert.deepEqual(service.searchPages("2026-11-20").items[0].match, { field: "attribute", id: experimentDay, name: "实验日期", snippet: "2026-11-20" });
    const tag = randomUUID(), definition = service.attributes.definition("tags");
    service.setDefinition("tags", { ...definition, metadata: { ...definition.metadata, options: [{ id: tag, name: "Research" }] } }, randomUUID());
    service.commitEdit({ pageId: e.id, batch: 1, blocks: [], attributes: { tags: [tag] } }, pageHistory(e.id));
    assert.equal(service.list({ keyword: tag }).total, 0);
    assert.equal(service.list({ keyword: "research" }).total, 1);
    assert.deepEqual(service.searchPages("research").items[0].match, { field: "attribute", id: "tags", name: "标签", snippet: "Research" });
    const dt = service.statement("SELECT typeof(value) FROM page_attrs WHERE page_id=? AND attr_id=?").pluck();
    for (const id of ["created_at", "modified_at", "schedule_start"]) assert.equal(dt.get(e.id, id), "integer");
});

test("quick open ranks titles, follows the first shared match and pages through live results", t => {
    const { service } = fixture(t);
    const a = service.create("editable", "A Signal"), b = service.create("editable", "B"), c = service.create("paper", "C");
    const d = service.create("editable", "D"), removed = service.create("editable", "Deleted Signal");
    const block = text(b.blocks[b.children[0]], "No match in the opening paragraph");
    const nested = { id: randomUUID(), type: "paragraph" as const, children: [], payload: payload("paragraph", "前".repeat(80) + "SiGnAl" + "后".repeat(80)) };
    const later = { ...nested, id: randomUUID(), payload: payload("paragraph", "later signal") };
    block.children = [nested.id, later.id];
    assert.equal(edit(service, b, [block, nested, later]).status, "saved");
    assert.equal(edit(service, a, [], [nested.id]).status, "saved");
    assert.equal(edit(service, d, [], [block.id]).status, "saved");
    service.attributes.write(c.id, { paper_authors: "Author SIGNAL" });
    const preview = service.trash([removed.id], workspaceHistory);
    if (preview.status !== "confirmation") throw Error("Expected confirmation");
    service.trash([removed.id], workspaceHistory, preview.preview.token);
    for (const [index, page] of [a, b, c, d].entries()) service.attributes.write(page.id, { modified_at: index + 1 }, true);
    const first = service.searchPages("  signal  ", 0, 2), next = service.searchPages("SIGNAL", 2, 2);
    assert.equal(first.total, 4);
    assert.deepEqual([...first.items, ...next.items].map(page => page.id), [a.id, d.id, c.id, b.id]);
    assert.deepEqual(first.items[0].match, { field: "title" });
    const body = { field: "body", snippet: "…" + "前".repeat(36) + "SiGnAl" + "后".repeat(36) + "…" };
    assert.deepEqual(first.items[1].match, body);
    assert.deepEqual(next.items[1].match, body);
    assert.deepEqual(next.items[0].match, { field: "attribute", id: "paper_authors", name: "作者", snippet: "Author SIGNAL" });
    assert.deepEqual(service.searchPages("signal", 4), { items: [], total: 4 });
    assert.deepEqual(service.list({ keyword: "signal" }).items.map(page => page.id), [d.id, c.id, b.id, a.id]);
    const scoped = viewIndex({ type: "library", keyword: "signal", language: "en",
        query: { conditions: [{ field: { kind: "title" }, operator: "not-equals", values: [c.title] }], sort: [] } });
    assert.deepEqual(new Set(scoped.ids), new Set([a.id, b.id, d.id]));
});

test("library sorting uses displayed values, pinyin, empty-last and stable ties during search", t => {
    const { service } = fixture(t);
    const sample = ["赵", "艾", "", "艾"].map((author, i) => service.create("paper", "Survey " + i, { paper_authors: author }));
    for (const [i, row] of sample.entries()) service.attributes.write(row.id, { modified_at: (i + 1) * 60 }, true);
    const sort = (direction: "asc" | "desc"): string[] => viewIndex({ type: "library", keyword: "Survey", language: "zh-CN", query: {
        conditions: [{ field: { kind: "page-type" }, operator: "in", values: ["paper"] }],
        sort: [{ field: { kind: "attribute", id: "paper_authors" }, direction }]
    } }).ids;
    assert.deepEqual(sort("asc"), [3, 1, 0, 2].map(i => sample[i].id));
    assert.deepEqual(sort("desc"), [0, 3, 1, 2].map(i => sample[i].id));
    service.attributes.write(sample[3].id, { modified_at: 120 }, true);
    assert.deepEqual(sort("asc").slice(0, 2), [sample[1].id, sample[3].id].sort());
    const ids = sample.map(p => p.id), preview = service.trash(ids, workspaceHistory);
    assert.ok(preview.status === "confirmation");
    assert.deepEqual(preview.preview.direct.map(p => p.id), ids);
    assert.equal(service.trash(ids, workspaceHistory, preview.preview.token).status, "saved");
    assert.equal(trashIndex({ language: "en", sort: [] }).ids.length, 4);
});

test("numeric library sorting keeps null and absent fields last and returns the ordered first batch", t => {
    const { service } = fixture(t);
    const column = "custom:" + randomUUID();
    service.attributes.applyDefinition(column, { id: column, type: "number", name: "Count", metadata: {} });
    const sample = ["A", "B", "C", "D", "E"].map(name => service.create("editable", name));
    [12, -2, 12, null].forEach((value, index) => service.attributes.write(sample[index].id, { [column]: value }));
    sample.forEach((page, index) => service.attributes.write(page.id, { modified_at: (index + 1) * 60 }, true));
    for (const direction of ["asc", "desc"] as const) {
        const numbers = direction === "asc" ? [1, 2, 0] : [2, 0, 1];
        const index = viewIndex({ type: "library", language: "en", query: { conditions: [], sort: [{ field: { kind: "attribute", id: column }, direction }] } }, [column]);
        assert.deepEqual(index.ids, [...numbers, 4, 3].map(i => sample[i].id));
        assert.deepEqual(index.initial?.map(page => page.id), index.ids);
    }
});

test("bulk trash recalculates dependent pages before accepting a fast preview token", t => {
    const { service } = fixture(t);
    const a = service.create("paper", "A"), b = service.create("paper", "B"), ids = [a.id, b.id];
    const fast = service.trash(ids, workspaceHistory);
    assert.ok(fast.status === "confirmation");
    assert.deepEqual(fast.preview.recycled, []);
    const child = service.create("annotation", "C", { independent: false }, a.id);
    const changed = service.trash(ids, workspaceHistory, fast.preview.token);
    assert.ok(changed.status === "confirmation");
    assert.deepEqual(changed.preview.recycled, [{ id: child.id, title: "C" }]);
    assert.equal(service.get(a.id).attributes.deleted, false);
    assert.equal(service.trash(ids, workspaceHistory, changed.preview.token).status, "saved");
    assert.equal(service.get(child.id).attributes.deleted, true);
});