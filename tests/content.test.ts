import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { EditHistory } from "../main/knowledge/history";
import { fingerprint } from "../main/knowledge/attributes";
import { payload, blockText } from "../shared/content/blocks";
import { type ContentBlock, type Mutation, type PageRecord } from "../shared/types/content";

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
function edit(service: KnowledgeService, page: PageRecord, changes: ContentBlock[], children = page.children, tabId = "tab-one"): ReturnType<KnowledgeService["mutate"]> {
    return service.mutate({ type: "edit", edit: { pageId: page.id, tabId, version: page.version, children, blocks: changes.map(value => ({ value, version: page.blockVersions[value.id] ?? null })) } });
}
function text(block: ContentBlock, value: string): ContentBlock {
    return { ...block, payload: payload(block.type, value) };
}
function confirm(service: KnowledgeService, mutation: Mutation): void {
    const preview = service.mutate(mutation, undefined, true);
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") assert.equal(service.mutate(mutation, preview.preview.token).status, "saved");
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
    const before = "2000-01-01T00:00:00.000Z";
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

test("opening legacy text and targetless references never rewrites the stored blocks", t => {
    const { service, database } = fixture(t);
    const page = service.create();
    const id = page.children[0];
    database.prepare("UPDATE blocks SET type = 'blocked_reference', content = ? WHERE id = ?").run("Original reference", id);
    const opened = service.get(page.id);
    assert.equal(opened.blocks[id].payload.target, null);
    assert.equal(blockText(opened.blocks[id]), "Original reference");
    assert.deepEqual(service.backlinks(page.id), []);
    assert.equal(database.prepare("SELECT content FROM blocks WHERE id = ?").pluck().get(id), "Original reference");
});

test("unlinking shallow-copies one occurrence and retains all child UUIDs", t => {
    const { service } = fixture(t);
    let page = service.create();
    const parent = page.blocks[page.children[0]], child = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "Child"), children: [] };
    parent.children = [child.id];
    edit(service, page, [parent, child], [parent.id, parent.id]);
    page = service.get(page.id);
    service.mutate({ type: "place", action: "clone", tabId: "tab-one", position: { pageId: page.id, kind: "page", containerId: page.id, index: 1, children: page.children } });
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
    const position = { pageId: page.id, kind: "page" as const, containerId: page.id, index: 1, children: [...page.children] };
    service.mutate({ type: "place", action: "remove", tabId: "tab-one", position });
    assert.deepEqual(service.get(page.id).children, [id]);
    assert.throws(() => service.mutate({ type: "place", action: "remove", tabId: "tab-one", position }), /位置已发生变化/);
    page = service.get(page.id);
    service.mutate({ type: "place", action: "remove", tabId: "tab-one", position: { ...position, index: 0, children: page.children } });
    assert.ok(service.readBlocks().has(id));
});

test("stale shared edits, conflicting duplicate records and containment cycles roll back", t => {
    const { service } = fixture(t);
    const page = service.create(), initial = page.blocks[page.children[0]];
    edit(service, page, [text(initial, "Fresh")]);
    assert.throws(() => edit(service, page, [text(initial, "Stale")]), /同步块已被其他/);
    const current = service.get(page.id), before = fingerprint(service.snapshot());
    assert.throws(() => edit(service, current, [{ ...current.blocks[initial.id], children: [initial.id] }]), /不能形成循环/);
    assert.equal(fingerprint(service.snapshot()), before);
    assert.throws(() => service.mutate({ type: "edit", edit: { pageId: page.id, tabId: "tab-one", version: current.version, blocks: [{ value: current.blocks[initial.id], version: current.blockVersions[initial.id] }, { value: current.blocks[initial.id], version: current.blockVersions[initial.id] }] } }), /只能为同一块/);
    assert.equal(fingerprint(service.snapshot()), before);
});

test("reference cycles lose retention together and only after the complete preview is confirmed", t => {
    const { service, database } = fixture(t);
    const root = service.create("editable", "Root");
    const a = service.create("editable", "A", { independent: false }, root.id);
    const b = service.create("editable", "B", { independent: false }, a.id);
    const backward = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "page" as const, id: a.id } }, children: [] };
    edit(service, b, [backward], [backward.id]);
    const before = fingerprint(service.snapshot()), timestamp = database.prepare("SELECT last_modified_at FROM workspace_meta").get();
    const mutation: Mutation = { type: "trash", ids: [root.id], tabId: "tab-one" };
    const pending = service.mutate(mutation);
    assert.equal(pending.status, "confirmation");
    if (pending.status !== "confirmation") return;
    assert.deepEqual(new Set(pending.preview.recycled.map(page => page.id)), new Set([a.id, b.id]));
    assert.equal(fingerprint(service.snapshot()), before);
    assert.deepEqual(database.prepare("SELECT last_modified_at FROM workspace_meta").get(), timestamp);
    service.mutate(mutation, pending.preview.token);
    assert.equal(service.get(root.id).attributes.recycle_reason, "manual_delete");
    assert.equal(service.get(a.id).attributes.recycle_reason, "unreachable");
    assert.equal(service.get(b.id).attributes.deleted, true);
    confirm(service, { type: "restore", ids: [a.id, b.id], tabId: "tab-one" });
    assert.equal(service.get(a.id).attributes.independent, true);
    assert.equal(service.get(a.id).attributes.recycled_at, null);
});

test("a reference to a shared block does not retain every page using that block", t => {
    const { service } = fixture(t);
    const root = service.create("editable", "Root"), child = service.create("editable", "Non-root", { independent: false }, root.id);
    const blockId = child.children[0], current = service.get(root.id);
    const reference = { id: randomUUID(), type: "blocked_reference" as const, payload: { ...payload("blocked_reference"), target: { kind: "block" as const, id: blockId } }, children: [] };
    const mutation: Mutation = { type: "edit", edit: { pageId: root.id, version: current.version, tabId: "tab-one", children: [reference.id], blocks: [{ value: reference, version: null }] } };
    const result = service.mutate(mutation);
    assert.equal(result.status, "confirmation");
    if (result.status !== "confirmation") return;
    assert.deepEqual(result.preview.recycled.map(page => page.id), [child.id]);
    service.mutate(mutation, result.preview.token);
    assert.ok(service.readBlocks().has(blockId));
    assert.equal(service.get(root.id).attributes.deleted, false);
});

test("a stale lifecycle confirmation cannot silently cover a changed graph", t => {
    const { service } = fixture(t);
    const root = service.create("editable", "Root");
    const mutation: Mutation = { type: "trash", ids: [root.id], tabId: "tab-one" };
    const preview = service.mutate(mutation);
    assert.equal(preview.status, "confirmation");
    if (preview.status !== "confirmation") return;
    const dependent = service.create("editable", "New dependent", { independent: false }, root.id);
    const next = service.mutate(mutation, preview.preview.token);
    assert.equal(next.status, "confirmation");
    assert.equal(service.get(root.id).attributes.deleted, false);
    assert.equal(service.get(dependent.id).attributes.deleted, false);
});

test("removing a retaining property previews both its owners and dependent pages atomically", t => {
    const { service, history } = fixture(t);
    const root = service.create("editable", "Owner");
    const dependent = service.create("editable", "Dependent");
    const id = `custom:${randomUUID()}`;
    service.setDefinition(id, { id, type: "page-link", metadata: { name: "Citation" } });
    service.mutate({ type: "edit", edit: { pageId: root.id, tabId: "owner", version: root.version, attributes: { [id]: dependent.id } } });
    service.mutate({ type: "edit", edit: { pageId: dependent.id, tabId: "dependent", version: dependent.version, attributes: { independent: false } } });
    const preview = service.setDefinition(id, null)!;
    assert.deepEqual(preview.pages.map(page => page.id), [root.id]);
    assert.deepEqual(preview.recycled?.map(page => page.id), [dependent.id]);
    assert.equal(service.get(root.id).attributes[id], dependent.id);
    assert.equal(service.get(dependent.id).attributes.deleted, false);
    assert.equal(history.state("owner").canUndo, true);
    service.create("editable", "Another edit");
    const fresh = service.setDefinition(id, null, preview.token)!;
    assert.notEqual(fresh.token, preview.token);
    assert.equal(service.setDefinition(id, null, fresh.token), null);
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
    assert.equal(restoredHistory.state("tab-one").canUndo, true);
    restoredHistory.close("tab-one");
    assert.equal(restoredHistory.state("tab-one").canUndo, false);
});