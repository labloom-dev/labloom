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
import { paperServices } from "./support/session";
import { payload } from "../shared/content/blocks";
import { arxivURL } from "../shared/utils/feed";
import { restoreTabState } from "../renderer/components/Tab/restore";
import { knownCoordinatePdf } from "./fixtures/pdf-text";
import { fixture as scaleFixture } from "./perf/fixture";
import { hasFailure } from "./failures";
import type { SavedTabs } from "../shared/workspace/tabs";
import type { CalendarPage } from "../shared/workspace/calendar";
import type { AttributeDefinition, AttributeImpact, AttributeValue } from "../shared/types/attributes";
import type { FeedState } from "../shared/types/feed";
import type { PaperResources } from "../shared/types/papers";
import { route } from "../main/ipc";
import { routes as pages } from "../main/pages/ipc";
import type { CommitResult, ContentBlock, PageBlockList, PageList, PageRecord, RichNode } from "../shared/types/content";
import { appChannels, attachmentsChannels, attributesChannels, feedChanged, feedChannels, historyChannels, pagesChanged, pagesChannels, papersChannels, settingsChanged, settingsChannels, startupChannels, timersChannels, workspaceChannels } from "../shared/ipc";

test("every group rejects malformed IPC arguments before side effects and accepts its declared shape", async t => {
    const root = (): string => mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-"));
    settings.initialize(root());
    session.open(root(), "create");
    const ipc = fixture(), log = t.mock.method(console, "error", () => { });
    t.after(async () => {
        ipc.contents.emit("destroyed"); session.close(); await settings.flush(settings.get().settingsRevision);
    });
    const malformed: [string, unknown[][]][] = [
        [attachmentsChannels.choose, [["audio"], ["image", "multiple"]]],
        [attachmentsChannels.importPath, [[42, ""], ["A", "C", { id: "B" }]]],
        [attachmentsChannels.uploadChunk, [["A", "bytes"]]],
        [pagesChannels.get, [[42]]], [pagesChannels.blockList, [[42]]],
        [pagesChannels.viewIndex, [[{ type: "table", language: "en", query: { conditions: [], sort: [] } }],
            [{ type: "library", language: "en", query: { conditions: [], sort: "title" } }],
            [{ type: "papers", language: "en", query: { conditions: [{ field: { kind: "title" }, operator: "unknown", values: [] }], sort: [] } }],
            [{ type: "library", language: "en", query: { conditions: [], sort: [], group: { field: { kind: "page-type" }, collapsed: [{}] } } }]]],
        [pagesChannels.trashIndex, [[{ language: "en", sort: [{ field: { kind: "title" }, direction: "newest" }] }]]],
        [pagesChannels.releaseView, [["not-a-session"]]],
        [pagesChannels.commitEdit, [[{ pageId: "A", batch: 0, blocks: [3] }, workspaceHistory],
            [{ batch: 0, blocks: [] }, workspaceHistory], [{ pageId: "A", batch: 0, blocks: [] }, workspaceHistory, undefined, 42],
            [{ pageId: "A", batch: 0, blocks: [] }]]],
        [pagesChannels.syncBlocks, [["A", []]]],
        [attributesChannels.define, [["A", { id: "A", name: 3, type: "string", metadata: {} }, "B"], ["A", { id: "A", type: "string" }, "B"], ["A", { id: "A", type: "string", name: "A", metadata: { options: 1 } }, "B"]]],
        [historyChannels.state, [["B"], [{ kind: "page" }], [{ kind: "tab", id: "B" }]]],
        [historyChannels.apply, [[workspaceHistory, "wrong"], [], ["", "undo"]]],
        [papersChannels.position, [["A", "B", { page: "1" }], ["A", "B", {}], ["A", "B", { page: 1, scale: false, rotation: 0, left: 0, top: 0 }]]],
        [timersChannels.set, [["A", "B", false, 4, "C"], [], ["A", null, 0, true, "C"]]],
        [workspaceChannels.saveTabs, [[{ groups: "A", layout: {}, focusedGroupId: "B" }], [{ groups: [] }], [{ groups: [], layout: { type: "group", groupId: null }, focusedGroupId: "B" }]]],
        [settingsChannels.update, [[{ window: { width: "A" } }], [{ lastWorkspace: { id: "A", name: "B" } }], [{ appearance: { timeZone: false } }]]],
        [startupChannels.chooseWorkspace, [[null], [], ["other"]]],
        [feedChannels.resolveSource, [[{ name: "A", url: 1 }], [{ name: "A" }], [{ name: "A", url: "A", autoRefresh: "on" }]]]
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
    const page = edits.create(workspaceHistory);
    const valid: [string, ...unknown[]][] = [[pagesChannels.list, { extra: true }], [attributesChannels.definitions], [historyChannels.state, workspaceHistory], [papersChannels.files, []], [timersChannels.settings, page.id], [workspaceChannels.saveTabs, { groups: [], layout: { type: "group", groupId: "A" }, focusedGroupId: "A" }], [settingsChannels.update, { layout: { width: 320 } }], [startupChannels.getState], [feedChannels.getState, {}]];
    for (const [channel, ...args] of valid) assert.equal((await ipc.invoke(channel, ...args)).ok, true, channel);
    events.feedChanged();
    for (const channel of [pagesChanged, settingsChanged, feedChanged]) assert.ok(ipc.sent.includes(channel), channel);
    ipc.contents.emit("destroyed");
    ipc.sent.length = 0;
    edits.create(workspaceHistory); events.feedChanged(); settings.update({ layout: { width: 321 } });
    assert.deepEqual(ipc.sent, []);
});

test("starter definitions belong to the workspace and dated ordinary pages follow their stable IDs", async t => {
    const path = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "starter-attrs-"));
    session.open(path, "create");
    const { call, invoke } = fixture(t);
    const definitions = (): Promise<AttributeDefinition[]> => call(attributesChannels.definitions);
    const ids = ["schedule_date", "schedule_start", "schedule_end", "task_status", "priority"];
    const starters = (await definitions()).filter(def => ids.includes(def.id));
    assert.deepEqual(starters.map(def => [def.id, def.type]).sort(), [
        ["priority", "select"], ["schedule_date", "day"], ["schedule_end", "minute"], ["schedule_start", "minute"], ["task_status", "status"]
    ]);
    assert.deepEqual(starters.find(def => def.type === "status")!.metadata.options?.map(o => [o.id, o.group]),
        [["todo", "incomplete"], ["doing", "incomplete"], ["done", "complete"]]);
    assert.equal((await invoke(pagesChannels.create, workspaceHistory, "paper", "typed title")).ok, false);
    const page = await call<PageRecord>(pagesChannels.create, workspaceHistory, "A", { schedule_date: 0 });
    await call(pagesChannels.create, workspaceHistory, "B", { schedule_date: null });
    await call(pagesChannels.create, workspaceHistory, "C");
    assert.throws(() => session.getNative().prepare("UPDATE pages SET kind=? WHERE id=?").run("unknown", page.id), /pages_kind/);
    assert.deepEqual(session.getNative().prepare("SELECT DISTINCT kind FROM pages").pluck().all(), ["editable"]);
    const calendar = (): Promise<CalendarPage[]> => call(pagesChannels.calendarRows, { date: "schedule_date", from: 0, to: 86400 });
    const date = starters.find(def => def.id === "schedule_date")!;
    assert.equal(await call(attributesChannels.define, date.id, { ...date, name: "会议日期" }), null);
    assert.deepEqual(await calendar(), [{ id: page.id, title: "A", date: 0, start: null, status: null, hasStatus: false, pinned: false }]);
    assert.deepEqual(await call(pagesChannels.calendarRows, { date: "schedule_date", from: 86400, to: 172800 }), []);
    assert.equal((await invoke(pagesChannels.calendarRows, { date: "schedule_date", from: 0, to: 86400, ids: ["invalid"] })).ok, false);
    for (const id of ids) {
        const impact = await call<AttributeImpact | null>(attributesChannels.define, id, null);
        if (impact) assert.equal(await call(attributesChannels.define, id, null, impact.token), null);
    }
    assert.deepEqual(await calendar(), []);
    session.close();
    session.open(path, "open");
    assert.deepEqual((await definitions()).filter(def => ids.includes(def.id)), []);
    assert.deepEqual(await calendar(), []);
});

test("review status values, groups and definition changes reschedule every reminder on the page", async t => {
    const now = 1800000000;
    session.open(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "status-reminders-")), "create", { clock: () => now * 1000, timeZone: () => "UTC" });
    const { call, invoke } = fixture(t);
    const id = "custom:" + randomUUID(), date = "custom:" + randomUUID();
    const options = [{ id: "waiting", name: "待审" }, { id: "reviewing", name: "审中" }, { id: "replied", name: "已回复" }];
    const single: AttributeDefinition = { id, type: "select", name: "审稿进度", metadata: { options } };
    const save = async (value: AttributeDefinition | null): Promise<void> => {
        const impact = await call<AttributeImpact | null>(attributesChannels.define, id, value);
        if (impact) assert.equal(await call(attributesChannels.define, id, value, impact.token), null);
    };
    await save(single);
    await call(attributesChannels.define, date, { id: date, name: "截止日期", type: "minute", metadata: {} });
    const page = await call<PageRecord>(pagesChannels.create, workspaceHistory, "A", { [date]: now + 3600, [id]: "replied" });
    await call(timersChannels.set, page.id, date, 0, true);
    await call(timersChannels.set, page.id, date, 300, true);
    const due = (muted: boolean): void => {
        assert.deepEqual(session.getNative().prepare("SELECT due_at FROM timers WHERE page_id=? ORDER BY lead_seconds").pluck().all(page.id),
            muted ? [null, null] : [now + 3600, now + 3300]);
    };
    const field = async (): Promise<AttributeDefinition> => (await call<AttributeDefinition[]>(attributesChannels.definitions)).find(def => def.id === id)!;
    const value = async (): Promise<AttributeValue> => (await call<PageRecord>(pagesChannels.get, page.id)).attributes[id];
    const edit = async (attributes: Record<string, AttributeValue>): Promise<void> => {
        assert.equal((await call<CommitResult>(pagesChannels.commitEdit, { pageId: page.id, batch: 0, blocks: [], attributes }, pageHistory(page.id))).status, "saved");
    };
    await save({ ...single, type: "status" });
    const status = await field();
    assert.deepEqual(status.metadata.options, options.map(o => ({ ...o, group: "incomplete" })));
    assert.equal(await value(), "replied"); due(false);
    const last = status.metadata.options!.at(-1)!;
    last.group = "complete"; await save(status); due(true);
    assert.equal((await call<PageList>(pagesChannels.list, { keyword: "已回复" })).total, 1);
    await edit({ [id]: "reviewing" }); due(false);
    await edit({ [id]: "replied" }); due(true);
    await edit({ task_status: "done", [id]: "reviewing" }); due(true);
    await edit({ task_status: "todo" }); due(false);
    await edit({ [id]: "replied" }); due(true);
    last.group = "incomplete"; await save(status); due(false);
    last.group = "complete"; await save(status); due(true);
    await save(single); due(false);
    assert.deepEqual(await field(), single);
    assert.equal(await value(), "replied");
    await save({ ...single, type: "status" }); await save(status); due(true);
    await save({ ...status, metadata: { options: status.metadata.options!.slice(0, 2) } }); due(false);
    assert.equal(await value(), null);
    assert.equal((await invoke(attributesChannels.define, id, { ...status, metadata: { options } })).ok, false);
    await save(status); await edit({ [id]: "replied" }); due(true);
    await save(null); due(false);
});

test("registered page handlers preserve long block text and attribute values on disk", async t => {
    const workspace = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-long-text-"));
    session.open(workspace, "create");
    const { call: invoke } = fixture(t);
    const initial = "A".repeat(20000), edited = "B".repeat(20000);
    const attr = "custom:" + randomUUID();
    await invoke(attributesChannels.define, attr, { id: attr, type: "string", name: "Body", metadata: {} });
    const page = await invoke(pagesChannels.create, workspaceHistory, "Long text", { [attr]: initial }) as PageRecord;
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
    const commit = { pageId: page.id, batch: 1, blocks, pageChildren: blocks.map(block => block.id), attributes: { [attr]: edited } };
    const saved = await invoke(pagesChannels.commitEdit, commit, pageHistory(page.id)) as CommitResult;
    assert.equal(saved.status, "saved");
    session.close();
    session.open(workspace, "open");
    const stored = await readPage();
    assert.equal(stored.attributes[attr], edited);
    for (const block of blocks) assert.deepEqual(stored.blocks[block.id], block);
    const matches = await invoke(pagesChannels.list, { attributes: { [attr]: edited } }) as { total: number };
    assert.equal(matches.total, 1);
});

test("an unconfirmed page save returns its impact while leaving the stored pages unchanged", async t => {
    session.open(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-confirm-save-")), "create");
    const { call } = fixture(t);
    const parent = await call<PageRecord>(pagesChannels.create, workspaceHistory, "Parent");
    const child = await call<PageRecord>(pagesChannels.create, workspaceHistory, "Child", {}, parent.id);
    const before = await call<PageRecord>(pagesChannels.get, parent.id);
    const edit = { pageId: parent.id, batch: 1, pageChildren: [], blocks: [] };
    const result = await call<CommitResult>(pagesChannels.commitEdit, edit, pageHistory(parent.id));
    assert.equal(result.status, "confirmation");
    assert.deepEqual(result.preview.recycled, [{ id: child.id, title: "Child" }]);
    assert.deepEqual(await call(pagesChannels.get, parent.id), before);
    assert.deepEqual(await call(pagesChannels.get, child.id), child);
});

test("picker lists repeated and nested blocks in order and batches live, recycled, untitled and missing target labels", async t => {
    session.open(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "picker-")), "create");
    const { call } = fixture(t);
    const owner = edits.create(workspaceHistory, "Picker"), untitled = edits.create(workspaceHistory), recycled = edits.create(workspaceHistory, "Archive");
    const paragraph = (id: string, text: string, children: string[] = []): ContentBlock => ({ id, type: "paragraph", payload: payload("paragraph", text), children });
    const blank = paragraph(untitled.children[0], ""), excerpt = paragraph(randomUUID(), "😀".repeat(140));
    edits.commitEdit({ pageId: untitled.id, batch: 0, blocks: [blank, excerpt], pageChildren: [blank.id, excerpt.id] }, false);
    const reference = (kind: "page" | "block", id: string): ContentBlock => ({
        id: randomUUID(), type: "blocked_reference", children: [], payload: { ...payload("blocked_reference"), target: { kind, id } }
    });
    const child = paragraph(randomUUID(), "  Two\nlines  "), top = paragraph(owner.children[0], "", [child.id]);
    const links = [reference("page", recycled.id), reference("page", untitled.id), reference("block", child.id), reference("block", randomUUID())];
    edits.commitEdit({ pageId: owner.id, batch: 0, blocks: [top, child, ...links], pageChildren: [top.id, child.id, ...links.map(b => b.id)] }, false);
    const trash = edits.trash([recycled.id], workspaceHistory);
    if (trash.status === "confirmation") edits.trash([recycled.id], workspaceHistory, trash.preview.token);
    const list = await call<PageBlockList>(pagesChannels.blockList, owner.id);
    assert.equal(list.title, "Picker");
    assert.deepEqual(list.rows.map(row => row.id), [top.id, child.id, child.id, ...links.map(b => b.id)]);
    assert.deepEqual(list.rows.map(row => row.depth), [0, 1, 0, 0, 0, 0, 0]);
    assert.deepEqual(list.rows.map(row => row.text), ["", "Two", "Two", "Archive", "😀".repeat(120), "  Two\nlines  ", ""]);
});

test("page titles, select options and deep JSON values round-trip through IPC", async t => {
    const path = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "ipc-values-"));
    session.open(path, "create");
    const { call, invoke } = fixture(t);
    const id = "custom:" + randomUUID();
    const options = Array.from({ length: 20000 }, (_, i) => ({ id: String(i), name: i === 0 ? "甲".repeat(500) : String(i) }));
    const definition = { id, name: "名".repeat(500), type: "select", metadata: { options } };
    await call(attributesChannels.define, id, definition);
    const jsonId = "custom:" + randomUUID();
    await call(attributesChannels.define, jsonId, { id: jsonId, name: "JSON", type: "json", metadata: {} });
    let nested: AttributeValue = "leaf";
    for (let i = 0; i < 60; i++) nested = { child: nested };
    const title = "甲".repeat(5000), edited = "乙".repeat(5000);
    const page = await call<PageRecord>(pagesChannels.create, workspaceHistory, title, { [id]: options.at(-1)!.id, [jsonId]: nested });
    assert.equal((await call<PageRecord>(pagesChannels.get, page.id)).title, title);
    const block = { ...page.blocks[page.titleBlockId], payload: payload("title", edited) };
    const change = { pageId: page.id, batch: 0, blocks: [block] };
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
        [attributesChannels.define, [id, { ...definition, metadata: { options: [options[0], { ...options[1], id: options[0].id }] } }], "attribute-invalid-metadata"]
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
    const sourceId = await call(feedChannels.saveSource, await call(feedChannels.resolveSource, { name, url, autoRefresh: false }));
    const arxivId = await call(feedChannels.saveSource, await call(feedChannels.resolveSource, { name: "arXiv", url: arxiv, autoRefresh: false }));
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
        groups[0].tabs.push({ id: "T".repeat(101), view: { type: "library", params: { query: {
            conditions: [{ field: { kind: "title" }, operator: "contains", values: ["A".repeat(1000001)] }],
            sort: [{ field: { kind: "title" }, direction: "asc" }]
        } } } });
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
    const papers = paperServices();
    const { pageId } = await papers.importFile(pdf);
    const [file] = (await papers.resources(pageId)).files;
    const rectangles = lines.map((_, i) => ({ x: 40, y: baseline(i) - 0.1, width: 65, height: 0.7 }));
    const selection = { fileId: file.id, pageNumber: 1, rectangles, quote, context: quote, extractorVersion: "A".repeat(201) };
    const empty = await invoke(papersChannels.annotate, pageId, { ...selection, rectangles: [] }, pageHistory(pageId));
    assert.equal(empty.ok ? "success" : empty.failure.kind, "invalid-argument");
    assert.equal(await call(papersChannels.prepareAnnotation, pageId, selection), true);
    const id = await call<string>(papersChannels.annotate, pageId, selection, pageHistory(pageId));
    session.close(); session.open(path, "open");
    const resources = await call<PaperResources>(papersChannels.resources, pageId);
    const stored = resources.annotations.find(annotation => annotation.id === id)!;
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
    const target = await call<PageRecord>(pagesChannels.create, workspaceHistory, "Destination");
    const workspace = session.getInfo(), ids = source.children;
    const started = performance.now();
    const blocks = await call<ContentBlock[]>(pagesChannels.syncBlocks, workspace.id, ids);
    const resolved = performance.now();
    const children = [...target.children, ...ids];
    const result = await call<{ status: string }>(pagesChannels.commitEdit, { pageId: target.id, batch: 1, blocks: [], pageChildren: children, sync: ids }, pageHistory(target.id));
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