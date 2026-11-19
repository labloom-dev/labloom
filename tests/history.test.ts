import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import * as settings from "../main/settings/store";
import { createReference } from "../main/knowledge/papers";
import * as history from "../main/knowledge/history";
import { blockText, payload } from "../shared/content/blocks";
import { historyChanged, historyChannels, pagesChannels, settingsChannels, workspaceChannels } from "../shared/ipc";
import type { HistorySource } from "../shared/history/ipc";
import type { CommitResult, PageRecord } from "../shared/types/content";
import type { SettingsResult } from "../shared/settings/Settings";
import type { SavedTabs } from "../shared/workspace/tabs";
import type { HistoryState } from "../shared/types/knowledge";
import { knowledgeServices, session } from "./support/session";
import { pageHistory, workspaceHistory } from "./support/history";
import { fixture } from "./support/ipc";

type HistoryFixture = {
    path: string; call: ReturnType<typeof fixture>["call"];
    state(source: HistorySource): Promise<HistoryState>;
    apply(source: HistorySource, direction: "undo" | "redo", token?: string): Promise<CommitResult>;
    read(id: string): Promise<PageRecord>; create(): Promise<PageRecord>;
    edit(page: PageRecord, text: string, source?: HistorySource): Promise<void>;
    text(page: PageRecord): Promise<string>; changed(...expected: HistorySource[]): void;
};
function setup(t: TestContext): HistoryFixture {
    const path = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "history-"));
    settings.initialize(path);
    session.open(path, "create");
    const { call, contents } = fixture(t);
    const notifications: HistorySource[][] = [];
    contents.on(historyChanged, (sources: HistorySource[]) => notifications.push(sources));
    const state = (source: HistorySource): Promise<HistoryState> => call<HistoryState>(historyChannels.state, source);
    const apply = (source: HistorySource, direction: "undo" | "redo", token?: string): Promise<CommitResult> =>
        call<CommitResult>(historyChannels.apply, source, direction, token);
    const read = (id: string): Promise<PageRecord> => call<PageRecord>(pagesChannels.get, id);
    const create = async (): Promise<PageRecord> => knowledgeServices().create();
    const edit = async (page: PageRecord, text: string, source = pageHistory(page.id)): Promise<void> => {
        const block = page.blocks[page.children[0]];
        assert.equal((await call<CommitResult>(pagesChannels.commitEdit, { pageId: page.id, batch: 1,
            blocks: [{ ...block, payload: payload("paragraph", text) }] }, source)).status, "saved");
    };
    const text = async (page: PageRecord): Promise<string> => {
        const current = await read(page.id);
        return blockText(current.blocks[current.children[0]]);
    };
    const changed = (...expected: HistorySource[]): void => {
        if (!expected.length) assert.deepEqual(notifications.splice(0), []);
        else {
            const [sources, ...extra] = notifications.splice(0);
            assert.deepEqual(extra, []);
            assert.equal(sources?.length, expected.length);
            assert.deepEqual(new Set(sources), new Set(expected));
        }
    };
    return { path, call, state, apply, read, create, edit, text, changed };
}
const empty = { canUndo: false, canRedo: false };

test("two tabs share one page cursor across tab closure, while reopening the workspace clears it", async t => {
    const f = setup(t), page = await f.create(), source = pageHistory(page.id);
    const tabs = (ids: string[]): SavedTabs => ({ groups: [{ id: "G", activeTabId: ids.at(-1) ?? null,
        tabs: ids.map(id => ({ id, view: { type: "page", params: { page: { kind: "page", id: page.id } } } })) }], focusedGroupId: "G", layout: { type: "group", groupId: "G" } });
    await f.call(workspaceChannels.saveTabs, tabs(["first", "second"]));
    await f.edit(page, "A"); f.changed(source);
    await f.edit(page, "B"); f.changed(source);
    await f.apply(source, "undo"); f.changed(source);
    assert.equal(await f.text(page), "A");
    const before = await f.state(source);
    await f.call(workspaceChannels.saveTabs, tabs([]));
    await f.call(workspaceChannels.saveTabs, tabs(["reopened"]));
    assert.deepEqual(await f.state(source), before); f.changed();
    await f.apply(source, "redo");
    assert.equal(await f.text(page), "B");
    session.close(); session.open(f.path, "open");
    assert.deepEqual(await f.state(source), empty);
    assert.equal(await f.text(page), "B");
});

test("one edit of a nested synced block and its inverses reach exactly the other owners", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), A = pageHistory(a.id), B = pageHistory(b.id);
    const shared = a.blocks[a.children[0]], parent = b.blocks[b.children[0]];
    await f.call(pagesChannels.commitEdit, { pageId: b.id, batch: 0, blocks: [{ ...parent, children: [shared.id] }] }, B);
    f.changed(A, B);
    const prototype = Object.getPrototypeOf(session.getNative().prepare("SELECT 1"));
    let expansions = 0;
    const all = prototype.all;
    const observed = t.mock.method(prototype, "all", function (this: { source: string }, ...args: unknown[]): unknown {
        if (/WITH RECURSIVE owners\(/i.test(this.source)) expansions++;
        return all.apply(this, args);
    });
    await f.edit(a, "shared"); f.changed(A, B);
    assert.equal(expansions, 1);
    observed.mock.restore();
    assert.ok((await f.state(A)).canUndo && (await f.state(B)).canUndo);
    await f.apply(B, "undo"); f.changed(A, B);
    assert.equal(await f.text(a), "");
    assert.ok((await f.state(B)).canRedo);
    await f.apply(B, "redo"); f.changed(A, B);
    assert.equal(await f.text(a), "shared");
    await f.apply(B, "undo"); f.changed(A, B);
    await f.apply(A, "undo"); f.changed(A, B);
    assert.equal(await f.text(a), "shared");
    await f.apply(B, "undo"); f.changed(A, B);
    assert.equal(await f.text(a), "");
});

test("deleting three papers is one reversible record across the library and all three pages", async t => {
    const f = setup(t), ids = ["A", "B", "C"].map(title => createReference({ title, authors: "", url: null, abstract: "", published: null, origin: {} }));
    const sources = ids.map(pageHistory), all = [workspaceHistory, ...sources];
    const preview = await f.call<CommitResult>(pagesChannels.trash, ids, workspaceHistory);
    assert.equal(preview.status, "confirmation"); f.changed();
    await f.call(pagesChannels.trash, ids, workspaceHistory, preview.preview.token); f.changed(...all);
    for (const source of all) assert.ok((await f.state(source)).canUndo);
    const deleted = (): Promise<unknown[]> => Promise.all(ids.map(async id => (await f.read(id)).attributes.deleted));
    assert.deepEqual(await deleted(), [true, true, true]);
    await f.apply(sources[1], "undo"); f.changed(...all);
    assert.deepEqual(await deleted(), [false, false, false]);
    await f.apply(workspaceHistory, "undo"); f.changed(...all);
    assert.deepEqual(await deleted(), [true, true, true]);
});

test("sidebar trash belongs to the workspace and the selected page, and truncation is local to each history", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), c = await f.create();
    const A = pageHistory(a.id), B = pageHistory(b.id), C = pageHistory(c.id), W = workspaceHistory;
    await f.call(workspaceChannels.saveTabs, { groups: [{ id: "G", activeTabId: "T", tabs: [{ id: "T", view: { type: "page", params: { page: A } } }] }],
        focusedGroupId: "G", layout: { type: "group", groupId: "G" } });
    const trash = async (id: string): Promise<void> => {
        const preview = await f.call<CommitResult>(pagesChannels.trash, [id], W);
        assert.equal(preview.status, "confirmation");
        await f.call(pagesChannels.trash, [id], W, preview.preview.token);
    };
    await trash(b.id); f.changed(W, B);
    assert.deepEqual(await f.state(A), empty);
    await f.apply(W, "undo"); f.changed(W, B);
    assert.equal((await f.read(b.id)).attributes.deleted, false);
    assert.ok((await f.state(W)).canRedo);
    await trash(c.id); f.changed(W, C);
    assert.equal((await f.state(W)).canRedo, false);
    await f.apply(B, "undo");
    assert.equal((await f.read(b.id)).attributes.deleted, true);
    await f.apply(B, "undo");
    assert.equal((await f.read(b.id)).attributes.deleted, false);
    await f.apply(B, "redo"); await f.apply(B, "redo");
    assert.equal((await f.read(b.id)).attributes.deleted, false);
    assert.equal((await f.read(c.id)).attributes.deleted, true);
});

test("invalidation reconnects the surviving predecessor and successor on one line", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), c = await f.create(), W = workspaceHistory;
    await f.edit(c, "first", W);
    await f.edit(a, "overlap", W);
    await f.edit(b, "last", W);
    await f.apply(W, "undo");
    await f.edit(a, "external");
    assert.deepEqual(await f.state(W), { canUndo: true, canRedo: true });
    await f.apply(W, "redo");
    assert.equal(await f.text(b), "last");
    assert.equal((await f.state(W)).canRedo, false);
    await f.apply(W, "undo"); await f.apply(W, "undo");
    assert.equal(await f.text(c), ""); assert.equal(await f.text(a), "external");
    assert.equal((await f.state(W)).canUndo, false);
});

test("the global record limit trims shared roots immediately, on commit, and stops at null", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), A = pageHistory(a.id), B = pageHistory(b.id), W = workspaceHistory;
    const limit = (value: number | null): Promise<SettingsResult> => f.call<SettingsResult>(settingsChannels.update, { history: { limit: value } });
    await f.edit(a, "one", W); f.changed(A, W);
    await f.edit(a, "two"); f.changed(A, W);
    // The second edit superseded the first workspace node. Share a fresh root across A and W.
    await f.edit(a, "three", W); f.changed(A, W);
    await f.edit(b, "one"); f.changed(B);
    await limit(3); f.changed(A);
    await f.edit(b, "two"); f.changed(A, B);
    await f.edit(b, "three"); f.changed(A, B, W);
    assert.deepEqual(await f.state(A), empty);
    assert.deepEqual(await f.state(W), empty);
    await f.apply(B, "undo"); f.changed(B);
    await f.apply(B, "undo"); f.changed(B);
    assert.ok((await f.state(B)).canUndo);
    await limit(1); f.changed(B);
    const cut = await f.state(B);
    assert.equal(cut.canUndo, false); assert.equal(cut.canRedo, true);
    await f.apply(B, "redo");
    assert.equal(await f.text(b), "three");
    await limit(null);
    for (const text of ["four", "five", "six"]) await f.edit(b, text);
    for (let i = 0; i < 3; i++) await f.apply(B, "undo");
    assert.equal(await f.text(b), "three"); assert.ok((await f.state(B)).canUndo);
});

test("emptying trash removes shared deleted records while an unrelated edit stays reversible", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), A = pageHistory(a.id), B = pageHistory(b.id), W = workspaceHistory;
    await f.edit(b, "keep"); f.changed(B);
    await f.edit(a, "remove", W); f.changed(A, W);
    const trash = await f.call<CommitResult>(pagesChannels.trash, [a.id], W);
    assert.equal(trash.status, "confirmation");
    await f.call(pagesChannels.trash, [a.id], W, trash.preview.token); f.changed(A, W);
    const preview = await f.call<{ token: string }>(pagesChannels.emptyTrash); f.changed();
    await f.call(pagesChannels.emptyTrash, preview.token); f.changed(A, W);
    assert.deepEqual(await f.state(A), empty); assert.deepEqual(await f.state(W), empty);
    await f.apply(B, "undo"); f.changed(B); assert.equal(await f.text(b), "");
    await f.apply(B, "redo"); f.changed(B); assert.equal(await f.text(b), "keep");
});

test("undoing the last retaining link previews recycling and accepts only the current token", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), B = pageHistory(b.id);
    const child = await f.call<PageRecord>(pagesChannels.create, workspaceHistory, "Child", { independent: false }, a.id);
    await f.call(pagesChannels.commitEdit, { pageId: b.id, batch: 0, blocks: [], attributes: { links: [child.id] } }, B);
    await f.call(pagesChannels.commitEdit, { pageId: a.id, batch: 0, blocks: [], pageChildren: a.children }, pageHistory(a.id));
    const before = await f.state(B), preview = await f.apply(B, "undo");
    assert.equal(preview.status, "confirmation");
    assert.deepEqual(await f.state(B), before); assert.equal((await f.read(child.id)).attributes.deleted, false);
    assert.equal((await f.apply(B, "undo", "stale")).status, "confirmation");
    assert.equal((await f.apply(B, "undo", preview.preview.token)).status, "saved");
    assert.equal((await f.read(child.id)).attributes.deleted, true);
});

test("nested writes in a single commit retain the earliest before and latest after for each field", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), A = pageHistory(a.id), B = pageHistory(b.id);
    const service = knowledgeServices();
    service.transaction(() => {
        for (const pinned of [true, false]) service.commitEdit({ pageId: a.id, batch: 0,
            blocks: [], attributes: { pinned } }, workspaceHistory);
        service.commitEdit({ pageId: b.id, batch: 0, blocks: [], attributes: { pinned: true } }, workspaceHistory);
    });
    f.changed(A, B, workspaceHistory);
    await f.apply(workspaceHistory, "undo"); f.changed(A, B, workspaceHistory);
    assert.equal((await f.read(a.id)).attributes.pinned, false);
    assert.equal((await f.read(b.id)).attributes.pinned, false);
    const state = await f.state(workspaceHistory);
    assert.equal(state.canUndo, false);
    assert.equal(state.canRedo, true);
    await f.apply(workspaceHistory, "redo");
    assert.equal((await f.read(b.id)).attributes.pinned, true);
});

test("rolled-back nested edits and replays keep rows, cursors, and notifications unchanged", async t => {
    const f = setup(t), page = await f.create(), source = pageHistory(page.id), service = knowledgeServices();
    await f.edit(page, "A"); f.changed(source);
    await f.apply(source, "undo"); f.changed(source);
    const before = await f.state(source);
    assert.ok(before.canRedo);
    assert.throws(() => service.transaction(() => {
        history.apply(source, "redo");
        service.commitEdit({ pageId: page.id, batch: 0, blocks: [], attributes: { pinned: true } }, workspaceHistory);
        throw new Error("abort");
    }), /abort/);
    f.changed(); assert.deepEqual(await f.state(source), before); assert.deepEqual(await f.state(workspaceHistory), empty);
    assert.equal(await f.text(page), ""); assert.equal((await f.read(page.id)).attributes.pinned, false);
});

test("removing a detached attribute definition invalidates history that could restore its values", t => {
    setup(t);
    const service = knowledgeServices(), page = service.create(), source = pageHistory(page.id);
    const definition = { id: "custom:" + randomUUID(), type: "string" as const, name: "A", metadata: {} };
    service.setDefinition(definition.id, definition);
    service.commitEdit({ pageId: page.id, batch: 1, blocks: [], attributes: { [definition.id]: "A" } }, source);
    service.setDefinition(definition.id, { ...definition, name: "B" });
    assert.equal(history.state(source).canUndo, true);
    service.commitEdit({ pageId: page.id, batch: 2, blocks: [], detach: [definition.id] }, source);
    assert.equal(history.state(source).canUndo, true);
    service.setDefinition(definition.id, null);
    assert.deepEqual(history.state(source), { canUndo: false, canRedo: false });
});