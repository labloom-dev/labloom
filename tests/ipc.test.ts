import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./support/ipc";
import { pageHistory, workspaceHistory } from "./support/history";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as settings from "../main/settings/store";
import * as session from "../main/session";
import * as edits from "../main/knowledge/edits";
import * as events from "../main/knowledge/events";
import * as papers from "../main/knowledge/papers";
import { payload } from "../shared/content/blocks";
import { arxivURL } from "../shared/utils/feed";
import { restoreTabState } from "../renderer/components/Tab/restore";
import { knownCoordinatePdf } from "./fixtures/pdf-text";
import { fixture as scaleFixture } from "./perf/fixture";
import { hasFailure } from "./failures";
import type { SavedTabs } from "../shared/workspace/tabs";
import type { AttributeDefinition, AttributeValue } from "../shared/types/attributes";
import type { FeedState } from "../shared/types/feed";
import type { PaperAnnotation } from "../shared/types/papers";
import { route } from "../main/ipc";
import { routes as pages } from "../main/pages/ipc";
import type { ContentBlock, PageRecord, RichNode } from "../shared/types/content";
import { appChannels, attributesChannels, feedChanged, feedChannels, historyChannels, pagesChanged, pagesChannels, papersChannels, settingsChanged, settingsChannels, startupChannels, timersChannels, workspaceChannels } from "../shared/ipc";

test("every group rejects malformed IPC arguments before side effects and accepts its declared shape", async t => {
    const root = (): string => mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-"));
    settings.initialize(root());
    session.open(root(), "create");
    const ipc = fixture(), log = t.mock.method(console, "error", () => { });
    t.after(async () => {
        ipc.contents.emit("destroyed"); session.close(); await settings.flush(settings.get().settingsRevision);
    });
    const malformed: [string, unknown[][]][] = [
        [pagesChannels.get, [[42]]],
        [pagesChannels.commitEdit, [[{ pageId: "A", tabId: "B", batch: 0, blocks: [3] }, workspaceHistory],
            [{ tabId: "B", batch: 0, blocks: [] }, workspaceHistory], [{ pageId: "A", tabId: "", batch: 0, blocks: [] }, workspaceHistory],
            [{ pageId: "A", tabId: "B", batch: 0, blocks: [] }]]],
        [pagesChannels.syncBlocks, [["A", []]]],
        [attributesChannels.define, [["A", { id: "A", name: 3, type: "string", metadata: {} }, "B"], ["A", { id: "A", type: "string" }, "B"], ["A", { id: "A", type: "string", name: "A", metadata: { options: 1 } }, "B"]]],
        [historyChannels.state, [["B"], [{ kind: "page" }], [{ kind: "tab", id: "B" }]]],
        [historyChannels.apply, [[workspaceHistory, "wrong"], [], ["", "undo"]]],
        [papersChannels.position, [["A", "B", { page: "1" }], ["A", "B", {}], ["A", "B", { page: 1, scale: false, rotation: 0, left: 0, top: 0 }]]],
        [timersChannels.set, [["A", "B", false, 4, "C"], [], ["A", null, 0, true, "C"]]],
        [workspaceChannels.saveTabs, [[{ groups: "A", layout: {}, focusedGroupId: "B" }], [{ groups: [] }], [{ groups: [], layout: { type: "group", groupId: null }, focusedGroupId: "B" }]]],
        [settingsChannels.update, [[{ window: { width: "A" } }], [{ lastWorkspace: { id: "A", name: "B" } }], [{ appearance: { timeZone: false } }]]],
        [startupChannels.chooseWorkspace, [[null], [], ["other"]]],
        [feedChannels.saveSource, [[{ name: "A", url: 1 }], [{ name: "A" }], [{ name: "A", url: "A", autoRefresh: "on" }]]]
    ];
    for (const [channel, cases] of malformed) for (const args of cases) {
        const result = await ipc.invoke(channel, ...args);
        assert.equal(result.ok, false, channel);
        if (result.ok) throw new Error(channel);
        assert.equal(result.failure.kind, "invalid-argument", channel);
        assert.match(result.failure.diagnostic ?? "", /^\$input.*: expected /, channel);
    }
    const service = t.mock.fn();
    assert.throws(() => route(pages.commitEdit.check, service)({ blocks: [] }));
    assert.equal(service.mock.callCount(), 0);
    assert.deepEqual(ipc.sent, []);
    const before = log.mock.callCount();
    ipc.send(appChannels.openDevTools, "extra");
    ipc.send(appChannels.beforeQuitResult, 42, false);
    assert.equal(log.mock.callCount(), before + 2);
    assert.equal(ipc.devTools.opened, 0);
    ipc.send(appChannels.openDevTools);
    assert.equal(ipc.devTools.opened, 1);
    const page = edits.create();
    const valid: [string, ...unknown[]][] = [[pagesChannels.list, { extra: true }], [attributesChannels.definitions], [historyChannels.state, workspaceHistory], [papersChannels.files, []], [timersChannels.settings, page.id], [workspaceChannels.saveTabs, { groups: [], layout: { type: "group", groupId: "A" }, focusedGroupId: "A" }], [settingsChannels.update, { layout: { width: 320 } }], [startupChannels.getState], [feedChannels.getState, {}]];
    for (const [channel, ...args] of valid) assert.equal((await ipc.invoke(channel, ...args)).ok, true, channel);
    events.feedChanged();
    for (const channel of [pagesChanged, settingsChanged, feedChanged]) assert.ok(ipc.sent.includes(channel), channel);
    ipc.contents.emit("destroyed");
    ipc.sent.length = 0;
    edits.create(); events.feedChanged(); settings.update({ layout: { width: 321 } });
    assert.deepEqual(ipc.sent, []);
});

test("registered page handlers preserve long block text and attribute values on disk", async t => {
    const workspace = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-long-text-"));
    session.open(workspace, "create");
    const { call: invoke } = fixture(t);
    const initial = "A".repeat(20000), edited = "B".repeat(20000);
    const attr = "custom:" + randomUUID();
    await invoke(attributesChannels.define, attr, { id: attr, type: "string", name: "Body", metadata: {} }, "A");
    const page = await invoke(pagesChannels.create, "editable", "Long text", { [attr]: initial }) as PageRecord;
    const readPage = async (): Promise<PageRecord> => await invoke(pagesChannels.get, page.id) as PageRecord;
    assert.equal((await readPage()).attributes[attr], initial);

    const blocks: ContentBlock[] = [];
    for (const type of ["code", "paragraph"] as const) {
        blocks.push({ id: type === "paragraph" ? page.children[0] : randomUUID(), type, children: [], payload: { type, schemaVersion: 1, inline: [{ type: "text", text: edited, marks: [{ type: "bold", attrs: { nested: [initial] } }] }] } });
    }
    let cell: RichNode = { type: "text", text: initial };
    for (const type of ["paragraph", "tableCell", "tableRow", "table"]) cell = { type, content: [cell] };
    blocks.push({ id: randomUUID(), type: "table", children: [], payload: { type: "table", schemaVersion: 1, inline: [], table: cell } });
    blocks.push({ id: randomUUID(), type: "paragraph", children: [], payload: { type: "paragraph", schemaVersion: 1, inline: [{ type: "inlineReference", attrs: { target: { kind: "page", id: page.id }, label: initial } }] } });
    const commit = { pageId: page.id, tabId: "A", batch: 1, blocks, pageChildren: blocks.map(block => block.id), attributes: { [attr]: edited } };
    assert.equal(await invoke(pagesChannels.previewEdit, commit), null);
    await invoke(pagesChannels.commitEdit, commit, pageHistory(page.id));
    session.close();
    session.open(workspace, "open");
    const stored = await readPage();
    assert.equal(stored.attributes[attr], edited);
    for (const block of blocks) assert.deepEqual(stored.blocks[block.id], block);
    const matches = await invoke(pagesChannels.list, { attributes: { [attr]: edited } }) as { total: number };
    assert.equal(matches.total, 1);
});

test("page titles, select options and deep JSON values round-trip through IPC", async t => {
    const path = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-values-"));
    session.open(path, "create");
    const { call, invoke } = fixture(t);
    const tab = "T".repeat(101), id = "custom:" + randomUUID();
    const options = Array.from({ length: 20000 }, (_, i) => ({ id: String(i), name: i === 0 ? "甲".repeat(500) : String(i) }));
    const definition = { id, name: "名".repeat(500), type: "select", metadata: { options } };
    await call(attributesChannels.define, id, definition, tab);
    const jsonId = "custom:" + randomUUID();
    await call(attributesChannels.define, jsonId, { id: jsonId, name: "JSON", type: "json", metadata: {} }, tab);
    let nested: AttributeValue = "leaf";
    for (let i = 0; i < 60; i++) nested = { child: nested };
    const title = "甲".repeat(5000), edited = "乙".repeat(5000);
    const page = await call<PageRecord>(pagesChannels.create, "editable", title, { [id]: options.at(-1)!.id, [jsonId]: nested });
    assert.equal((await call<PageRecord>(pagesChannels.get, page.id)).title, title);
    const block = { ...page.blocks[page.titleBlockId], payload: payload("title", edited) };
    const change = { pageId: page.id, tabId: tab, batch: 0, blocks: [block] };
    await call(pagesChannels.commitEdit, change, pageHistory(page.id));
    session.close(); session.open(path, "open");
    const stored = await call<PageRecord>(pagesChannels.get, page.id);
    assert.equal(stored.title, edited);
    assert.deepEqual(stored.blocks[page.titleBlockId], block);
    assert.deepEqual(stored.attributes[jsonId], nested);
    assert.equal(stored.attributes[id], options.at(-1)!.id);
    const definitions = await call<AttributeDefinition[]>(attributesChannels.definitions);
    assert.deepEqual(definitions.find(item => item.id === id), definition);

    const invalid = [
        [pagesChannels.commitEdit, [{ ...change, blocks: [{ ...block, id: "not-a-uuid" }] }, pageHistory(page.id)], "block-invalid-identity"],
        [pagesChannels.commitEdit, [{ ...change, blocks: [{ ...block, children: [page.children[0]] }] }, pageHistory(page.id)], "block-invalid-title"],
        [attributesChannels.define, [id, { ...definition, metadata: { options: [options[0], { ...options[1], id: options[0].id }] } }, tab], "attribute-invalid-metadata"]
    ] as const;
    for (const [channel, args, kind] of invalid) {
        const reply = await invoke(channel, ...args);
        assert.equal(reply.ok ? "success" : reply.failure.kind, kind);
    }
    const updates = await call<{ order: string[]; items: unknown[] }>(pagesChannels.listUpdates, { limit: 500 }, Array(300).fill(page.id));
    assert.deepEqual(updates.order, [page.id]);
    assert.deepEqual(updates.items, []);
});

test("long subscription details and followed keywords survive a workspace reopen", async t => {
    const path = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-feed-"));
    session.open(path, "create", { loadFeed: async ({ url }) => ({ url, title: "", entries: [], etag: null, lastModified: null }) });
    const { call } = fixture(t);
    const name = "名".repeat(300), url = "https://example.org/".padEnd(10000, "a");
    const phrase = "词".repeat(300), arxiv = arxivURL("cs.AI", phrase);
    assert.equal(new URL(arxiv).searchParams.get("search_query"), `(cat:cs.AI) AND (ti:"${phrase}" OR abs:"${phrase}")`);
    for (const invalid of ["a\"b", "a\\b"]) assert.throws(() => arxivURL("cs.AI", invalid), hasFailure("arxiv-invalid-keyword"));
    const sourceId = await call(feedChannels.saveSource, { name, url, autoRefresh: false });
    const arxivId = await call(feedChannels.saveSource, { name: "arXiv", url: arxiv, autoRefresh: false });
    const keywords = Array.from({ length: 100 }, (_, i) => String(i).padStart(200, "a"));
    await call(feedChannels.setKeywords, keywords);
    session.close(); session.open(path, "open");
    const state = await call<FeedState>(feedChannels.getState, {});
    assert.deepEqual(state.keywords, keywords);
    const source = state.sources.find(row => row.id === sourceId)!;
    assert.equal(source.name, name);
    assert.equal(source.url, url);
    assert.equal(state.sources.find(row => row.id === arxivId)?.url, arxiv);
});

test("large layouts survive IPC storage and renderer restoration", async t => {
    const path = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-layout-"));
    session.open(path, "create");
    const { call } = fixture(t);
    for (const count of [33, 41]) {
        const groups: SavedTabs["groups"] = Array.from({ length: count }, (_, i) => ({ id: String(i), tabs: [], activeTabId: null }));
        groups[0].tabs.push({ id: "T".repeat(101), type: "overview", title: "A".repeat(1000001) });
        groups[0].activeTabId = groups[0].tabs[0].id;
        let layout: SavedTabs["layout"] = { type: "group", groupId: "0" };
        for (const group of groups.slice(1)) layout = { type: "split", direction: "horizontal", ratio: 0.5, children: [layout, { type: "group", groupId: group.id }] };
        const saved = { groups, focusedGroupId: "0", layout };
        await call(workspaceChannels.saveTabs, saved);
        session.close(); session.open(path, "open");
        assert.deepEqual(restoreTabState(await call(workspaceChannels.loadTabs)), saved);
        assert.equal(restoreTabState({ ...saved, focusedGroupId: "missing" }), undefined);
        assert.equal(restoreTabState({ ...saved, layout: { ...layout, children: [layout, layout] } }), undefined);
    }
});

test("registered annotation handlers extract and store a 200000-character PDF selection", async t => {
    const path = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-annotation-"));
    session.open(path, "create");
    const { call, invoke } = fixture(t);
    const lines = Array.from({ length: 1000 }, (_, i) => String(i).padStart(i === 999 ? 200 : 199, "A"));
    const quote = lines.join("\n");
    assert.equal(quote.length, 200000);
    const baseline = (i: number): number => 810 - i * 0.75;
    const stream = lines.map((line, i) => `BT /F1 0.5 Tf 1 0 0 1 40 ${baseline(i)} Tm (${line}) Tj ET`).join("\n");
    const pdf = join(path, "selection.pdf");
    writeFileSync(pdf, knownCoordinatePdf(true, stream));
    const { pageId } = papers.importFile(pdf);
    const [file] = (await papers.resources(pageId)).files;
    const rectangles = lines.map((_, i) => ({ x: 40, y: baseline(i) - 0.1, width: 65, height: 0.7 }));
    const selection = { fileId: file.id, pageNumber: 1, rectangles, quote, context: quote, extractorVersion: "A".repeat(201) };
    const empty = await invoke(papersChannels.annotate, pageId, { ...selection, rectangles: [] }, "A", pageHistory(pageId));
    assert.equal(empty.ok ? "success" : empty.failure.kind, "invalid-argument");
    const id = await call<string>(papersChannels.annotate, pageId, selection, "A", pageHistory(pageId));
    session.close(); session.open(path, "open");
    const stored = await call<PaperAnnotation>(papersChannels.getAnnotation, id);
    assert.deepEqual(stored.rectangles, rectangles);
    assert.equal(stored.quote.length, quote.length);
    assert.equal(stored.quote, quote);
    assert.equal(stored.context, quote);
});

test("a registered sync paste preserves 12000 shared blocks on disk", async t => {
    const { sql, service, makePage } = scaleFixture();
    const source = sql.transaction(() => makePage(12001, "Source"))();
    service.rebuildLinks();
    const { call } = fixture(t);
    const target = await call<PageRecord>(pagesChannels.create, "editable", "Destination");
    const workspace = session.getInfo(), ids = source.children;
    const started = performance.now();
    const blocks = await call<ContentBlock[]>(pagesChannels.syncBlocks, workspace.id, ids);
    const resolved = performance.now();
    const children = [...target.children, ...ids];
    const result = await call<{ status: string }>(pagesChannels.commitEdit, { pageId: target.id, tabId: "A", batch: 1, blocks: [], pageChildren: children, sync: ids }, pageHistory(target.id));
    t.diagnostic(`12000-block paste | resolve ${(resolved - started).toFixed(2)} ms | resolve + commit ${(performance.now() - started).toFixed(2)} ms`);
    assert.equal(result.status, "saved");
    assert.equal(blocks.length, ids.length);
    session.close(); session.open(workspace.path, "open");
    const saved = await call<PageRecord>(pagesChannels.get, target.id);
    assert.deepEqual(saved.children, children);
    for (const block of blocks) {
        assert.equal(saved.sharedUses[block.id], 2);
        assert.deepEqual(saved.blocks[block.id], block);
    }
});