import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import * as settings from "../main/settings/store";
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
    apply(source: HistorySource, direction: "undo" | "redo", branch?: string, token?: string): Promise<CommitResult>;
    read(id: string): Promise<PageRecord>; create(kind?: string): Promise<PageRecord>;
    edit(page: PageRecord, tabId: string, text: string, source?: HistorySource): Promise<void>;
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
    const apply = (source: HistorySource, direction: "undo" | "redo", branch?: string, token?: string): Promise<CommitResult> =>
        call<CommitResult>(historyChannels.apply, source, direction, branch, token);
    const read = (id: string): Promise<PageRecord> => call<PageRecord>(pagesChannels.get, id);
    const create = (kind = "editable"): Promise<PageRecord> => call<PageRecord>(pagesChannels.create, kind);
    const edit = async (page: PageRecord, tabId: string, text: string, source = pageHistory(page.id)): Promise<void> => {
        const block = page.blocks[page.children[0]];
        assert.equal((await call<CommitResult>(pagesChannels.commitEdit, { pageId: page.id, tabId, batch: 1,
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
const empty = { canUndo: false, redo: [] };

test("two tabs share one page cursor across tab closure, while reopening the workspace clears it", async t => {
    const f = setup(t), page = await f.create(), source = pageHistory(page.id);
    const tabs = (ids: string[]): SavedTabs => ({ groups: [{ id: "G", activeTabId: ids.at(-1) ?? null,
        tabs: ids.map(id => ({ id, type: "page", pageId: page.id, title: "Page" })) }], focusedGroupId: "G", layout: { type: "group", groupId: "G" } });
    await f.call(workspaceChannels.saveTabs, tabs(["first", "second"]));
    await f.edit(page, "first", "A"); f.changed(source);
    await f.edit(page, "second", "B"); f.changed(source);
    await f.apply(source, "undo"); f.changed(source);
    assert.equal(await f.text(page), "A");
    const before = await f.state(source);
    await f.call(workspaceChannels.saveTabs, tabs([]));
    await f.call(workspaceChannels.saveTabs, tabs(["reopened"]));
    assert.deepEqual(await f.state(source), before); f.changed();
    await f.apply(source, "redo", before.redo[0].id);
    assert.equal(await f.text(page), "B");
    session.close(); session.open(f.path, "open");
    assert.deepEqual(await f.state(source), empty);
    assert.equal(await f.text(page), "B");
});

test("one edit of a nested synced block and its inverses reach exactly the other owners", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), A = pageHistory(a.id), B = pageHistory(b.id);
    const shared = a.blocks[a.children[0]], parent = b.blocks[b.children[0]];
    await f.call(pagesChannels.commitEdit, { pageId: b.id, tabId: "b", batch: 0, blocks: [{ ...parent, children: [shared.id] }] }, B);
    f.changed(A, B);
    const prototype = Object.getPrototypeOf(session.getNative().prepare("SELECT 1"));
    let expansions = 0;
    const all = prototype.all;
    const observed = t.mock.method(prototype, "all", function (this: { source: string }, ...args: unknown[]): unknown {
        if (/WITH RECURSIVE owners\(/i.test(this.source)) expansions++;
        return all.apply(this, args);
    });
    await f.edit(a, "a", "shared"); f.changed(A, B);
    assert.equal(expansions, 1);
    observed.mock.restore();
    assert.ok((await f.state(A)).canUndo && (await f.state(B)).canUndo);
    await f.apply(B, "undo"); f.changed(A, B);
    assert.equal(await f.text(a), "");
    const branch = (await f.state(B)).redo[0].id;
    await f.apply(B, "redo", branch); f.changed(A, B);
    assert.equal(await f.text(a), "shared");
    await f.apply(B, "undo"); f.changed(A, B);
    await f.apply(A, "undo"); f.changed(A, B);
    assert.equal(await f.text(a), "shared");
    await f.apply(B, "undo"); f.changed(A, B);
    assert.equal(await f.text(a), "");
});

test("deleting three papers is one reversible record across the library and all three pages", async t => {
    const f = setup(t), papers = await Promise.all([f.create("paper"), f.create("paper"), f.create("paper")]);
    const ids = papers.map(page => page.id), sources = ids.map(pageHistory), all = [workspaceHistory, ...sources];
    const preview = await f.call<CommitResult>(pagesChannels.trash, ids, "library", workspaceHistory);
    assert.equal(preview.status, "confirmation"); f.changed();
    await f.call(pagesChannels.trash, ids, "library", workspaceHistory, preview.preview.token); f.changed(...all);
    for (const source of all) assert.ok((await f.state(source)).canUndo);
    const deleted = (): Promise<unknown[]> => Promise.all(ids.map(async id => (await f.read(id)).attributes.deleted));
    assert.deepEqual(await deleted(), [true, true, true]);
    await f.apply(sources[1], "undo"); f.changed(...all);
    assert.deepEqual(await deleted(), [false, false, false]);
    await f.apply(workspaceHistory, "undo"); f.changed(...all);
    assert.deepEqual(await deleted(), [true, true, true]);
});

test("invalidation splices redo branches onto the nearest surviving ancestor and retreats the cursor", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), c = await f.create(), W = workspaceHistory;
    await f.edit(c, "list", "ancestor", W); f.changed(W, pageHistory(c.id));
    await f.edit(a, "list", "overlap", W); f.changed(W, pageHistory(a.id));
    await f.edit(b, "list", "branch one", W); f.changed(W, pageHistory(b.id));
    await f.apply(W, "undo"); f.changed(W, pageHistory(b.id));
    const branch = (await f.state(W)).redo[0].id;
    await f.edit(b, "list", "branch two", W); f.changed(W, pageHistory(b.id));
    await f.apply(W, "undo"); f.changed(W, pageHistory(b.id));
    await f.edit(a, "page", "external"); f.changed(W, pageHistory(a.id));
    const spliced = await f.state(W);
    assert.equal(spliced.canUndo, true);
    assert.equal(spliced.redo.length, 2);
    await f.apply(W, "redo", branch);
    assert.equal(await f.text(b), "branch one");
    await f.apply(W, "undo"); await f.apply(W, "undo");
    assert.equal(await f.text(c), ""); assert.equal(await f.text(a), "external");
});

test("the global record limit trims shared roots immediately, on commit, and stops at null", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), A = pageHistory(a.id), B = pageHistory(b.id), W = workspaceHistory;
    const limit = (value: number | null): Promise<SettingsResult> => f.call<SettingsResult>(settingsChannels.update, { history: { limit: value } });
    await f.edit(a, "list", "one", W); f.changed(A, W);
    await f.edit(a, "a", "two"); f.changed(A, W);
    // The second edit superseded the first workspace node. Share a fresh root across A and W.
    await f.edit(a, "list", "three", W); f.changed(A, W);
    await f.edit(b, "b", "one"); f.changed(B);
    await limit(3); f.changed(A);
    await f.edit(b, "b", "two"); f.changed(A, B);
    await f.edit(b, "b", "three"); f.changed(A, B, W);
    assert.deepEqual(await f.state(A), empty);
    assert.deepEqual(await f.state(W), empty);
    await f.apply(B, "undo"); f.changed(B);
    await f.apply(B, "undo"); f.changed(B);
    assert.ok((await f.state(B)).canUndo);
    await limit(1); f.changed(B);
    const cut = await f.state(B);
    assert.equal(cut.canUndo, false); assert.equal(cut.redo.length, 1);
    await f.apply(B, "redo", cut.redo[0].id);
    assert.equal(await f.text(b), "three");
    await limit(null);
    for (const text of ["four", "five", "six"]) await f.edit(b, "b", text);
    for (let i = 0; i < 3; i++) await f.apply(B, "undo");
    assert.equal(await f.text(b), "three"); assert.ok((await f.state(B)).canUndo);
});

test("emptying trash removes shared deleted records while an unrelated edit stays reversible", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), A = pageHistory(a.id), B = pageHistory(b.id), W = workspaceHistory;
    await f.edit(b, "b", "keep"); f.changed(B);
    await f.edit(a, "list", "remove", W); f.changed(A, W);
    const trash = await f.call<CommitResult>(pagesChannels.trash, [a.id], "list", W);
    assert.equal(trash.status, "confirmation");
    await f.call(pagesChannels.trash, [a.id], "list", W, trash.preview.token); f.changed(A, W);
    const preview = await f.call<{ token: string }>(pagesChannels.emptyTrash, "list"); f.changed();
    await f.call(pagesChannels.emptyTrash, "list", preview.token); f.changed(A, W);
    assert.deepEqual(await f.state(A), empty); assert.deepEqual(await f.state(W), empty);
    await f.apply(B, "undo"); f.changed(B); assert.equal(await f.text(b), "");
    await f.apply(B, "redo"); f.changed(B); assert.equal(await f.text(b), "keep");
});

test("undoing the last retaining link previews recycling and accepts only the current token", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), B = pageHistory(b.id);
    const child = await f.call<PageRecord>(pagesChannels.create, "editable", "Child", { independent: false }, a.id);
    await f.call(pagesChannels.commitEdit, { pageId: b.id, tabId: "B", batch: 0, blocks: [], attributes: { links: [child.id] } }, B);
    await f.call(pagesChannels.commitEdit, { pageId: a.id, tabId: "A", batch: 0, blocks: [], pageChildren: a.children }, pageHistory(a.id));
    const before = await f.state(B), preview = await f.apply(B, "undo");
    assert.equal(preview.status, "confirmation");
    assert.deepEqual(await f.state(B), before); assert.equal((await f.read(child.id)).attributes.deleted, false);
    assert.equal((await f.apply(B, "undo", undefined, "stale")).status, "confirmation");
    assert.equal((await f.apply(B, "undo", undefined, preview.preview.token)).status, "saved");
    assert.equal((await f.read(child.id)).attributes.deleted, true);
});

test("nested writes in a single commit retain the earliest before and latest after for each field", async t => {
    const f = setup(t), a = await f.create(), b = await f.create(), A = pageHistory(a.id), B = pageHistory(b.id);
    const service = knowledgeServices();
    service.transaction(() => {
        for (const pinned of [true, false]) service.commitEdit({ pageId: a.id, tabId: "list", batch: 0,
            blocks: [], attributes: { pinned } }, workspaceHistory);
        service.commitEdit({ pageId: b.id, tabId: "list", batch: 0, blocks: [], attributes: { pinned: true } }, workspaceHistory);
    });
    f.changed(A, B, workspaceHistory);
    await f.apply(workspaceHistory, "undo"); f.changed(A, B, workspaceHistory);
    assert.equal((await f.read(a.id)).attributes.pinned, false);
    assert.equal((await f.read(b.id)).attributes.pinned, false);
    const state = await f.state(workspaceHistory);
    assert.equal(state.canUndo, false);
    assert.equal(state.redo.length, 1);
    await f.apply(workspaceHistory, "redo");
    assert.equal((await f.read(b.id)).attributes.pinned, true);
});

test("rolled-back nested edits and replays keep rows, cursors, and notifications unchanged", async t => {
    const f = setup(t), page = await f.create(), source = pageHistory(page.id), service = knowledgeServices();
    await f.edit(page, "a", "A"); f.changed(source);
    await f.apply(source, "undo"); f.changed(source);
    const before = await f.state(source);
    assert.ok(before.redo[0].time > 1e12);
    assert.throws(() => service.transaction(() => {
        history.apply(source, "redo");
        service.commitEdit({ pageId: page.id, tabId: "b", batch: 0, blocks: [], attributes: { pinned: true } }, workspaceHistory);
        throw new Error("abort");
    }), /abort/);
    f.changed(); assert.deepEqual(await f.state(source), before); assert.deepEqual(await f.state(workspaceHistory), empty);
    assert.equal(await f.text(page), ""); assert.equal((await f.read(page.id)).attributes.pinned, false);
});

test("removing a detached attribute definition invalidates history that could restore its values", t => {
    setup(t);
    const service = knowledgeServices(), page = service.create(), source = pageHistory(page.id);
    const definition = { id: "custom:" + randomUUID(), type: "string" as const, name: "A", metadata: {} };
    service.setDefinition(definition.id, definition, "manager");
    service.commitEdit({ pageId: page.id, tabId: "a", batch: 1, blocks: [], attributes: { [definition.id]: "A" } }, source);
    service.setDefinition(definition.id, { ...definition, name: "B" }, "manager");
    assert.equal(history.state(source).canUndo, true);
    service.commitEdit({ pageId: page.id, tabId: "a", batch: 2, blocks: [], detach: [definition.id] }, source);
    assert.equal(history.state(source).canUndo, true);
    service.setDefinition(definition.id, null, "manager");
    assert.deepEqual(history.state(source), { canUndo: false, redo: [] });
});