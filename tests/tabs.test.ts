import assert from "node:assert/strict";
import test from "node:test";
import { validate, version } from "uuid";
import { getGroupID, getTabID } from "../renderer/components/Tab/ids";
import { defaultTable, defaultTrash } from "../shared/workspace/table";
import { restoreTabState } from "../renderer/components/Tab/restore";
import { defaultCalendar } from "../shared/workspace/calendar";
import { TabVisits, type TabView } from "../renderer/components/Tab/visits";

function latch(): { wait: Promise<void>; release: () => void } {
    let release!: () => void;
    const wait = new Promise<void>(resolve => {
 release = resolve;
});
    return { wait, release };
}
type TestPage = (id: string, visible: string[], options?: Partial<TabView>) => Promise<string[][]>;
function harness(): { visits: TabVisits; locks: Set<string>; errors: unknown[]; page: TestPage } {
    const locks = new Set<string>(), errors: unknown[] = [];
    const visits = new TabVisits((id, on) => {
        if (on) locks.add(id); else locks.delete(id);
    }, problem => errors.push(problem));
    async function page(id: string, visible: string[], options: Partial<TabView> = {}): Promise<string[][]> {
        const reads: string[][] = [];
        visits.register(id, {
            changed: change => [...change.pages, ...change.blocks].filter(object => visible.includes(object)),
            read: async (ids, initial) => {
 if (!initial) reads.push(ids);
},
            pending: () => false, flush: async () => true, ...options
        });
        assert.equal(await visits.settled(id), true);
        return reads;
    }
    return { visits, locks, errors, page };
}

test("new tab and group IDs are distinct bare UUIDs, and legacy identities stay opaque", async () => {
    const ids = Array.from({ length: 50 }, () => [getTabID(), getGroupID()]).flat();
    assert.equal(new Set(ids).size, 100);
    assert.ok(ids.every(id => validate(id) && version(id) === 4));
    const { visits, page } = harness();
    const legacy = "tab-" + getTabID(), reads = await page(legacy, ["A"]);
    visits.focus(legacy);
    visits.changed({ pages: ["A"], blocks: [] });
    visits.changed({ pages: ["A"], blocks: ["other"] });
    await visits.settled(legacy);
    assert.deepEqual(reads, [["A"]]);
});

test("leaving flushes immediately; an entering pane waits for the acknowledgement and reads only its intersection", async () => {
    const { visits, locks, page } = harness(), ack = latch(), reading = latch(), started = latch();
    let saves = 0;
    await page("left", ["A", "X"], { pending: () => true,
        flush: async () => {
 saves++; await ack.wait; return true;
} });
    const reads: string[][] = [];
    await page("right", ["B", "X"], { read: async (ids, initial) => {
        if (initial) return;
        reads.push(ids);
        started.release();
        await reading.wait;
    } });
    visits.focus("left");
    visits.focus("right");
    assert.equal(saves, 1);
    assert.ok(locks.has("right"));
    visits.changed({ pages: ["A"], blocks: ["X", "other"] });
    await Promise.resolve();
    assert.deepEqual(reads, []);
    ack.release();
    await started.wait;
    visits.changed({ pages: ["B"], blocks: ["X", "other"] });
    reading.release();
    assert.ok(await visits.settled("right"));
    assert.deepEqual(reads, [["X"], ["B", "X"]]);
    assert.ok(!locks.has("right"));
});

test("an unrelated destination waits for a pending departure and coalesces later broadcasts", async () => {
    const { visits, locks, page } = harness(), done = latch();
    let saves = 0;
    const reads = await page("one", ["A"], { pending: () => true, flush: async () => {
        saves++; await done.wait; return true;
    } });
    await page("two", ["B"]);
    visits.focus("one");
    visits.focus("two");
    assert.equal(saves, 1);
    assert.ok(locks.has("two"));
    done.release();
    await visits.settled("two");
    visits.focus(null);
    visits.changed({ pages: ["A"], blocks: [] });
    visits.changed({ pages: ["A"], blocks: [] });
    assert.deepEqual(reads, []);
    visits.focus("one");
    await visits.settled("one");
    assert.deepEqual(reads, [["A"]]);
    visits.focus(null);
    assert.equal(saves, 2);
});

test("rapid visits commit the middle tab's buffered input before the next tab reads", async () => {
    const { visits, page } = harness(), wait = latch(), order: string[] = [];
    await page("a", ["X"], { pending: () => true, flush: async () => {
        await wait.wait;
        visits.changed({ pages: [], blocks: ["X"] });
        return true;
    } });
    await page("b", ["X"], { pending: () => true, ready: () => order.push("apply keys"), flush: async () => {
        order.push("save b");
        visits.changed({ pages: [], blocks: ["X"] });
        return true;
    } });
    await page("c", ["X"], { read: async (_ids, initial) => {
 if (!initial) order.push("read c");
} });
    order.length = 0;
    visits.focus("a"); visits.focus("b"); visits.focus("c");
    wait.release();
    await visits.settled("c");
    assert.deepEqual(order, ["apply keys", "save b", "read c"]);
});

test("failed reads retain the exact invalidations and stay read-only until a successful visit", async () => {
    const { visits, locks, errors, page } = harness(), reads: string[][] = [];
    let fail = true;
    await page("a", ["X"], { read: async (ids, initial) => {
        if (initial) return;
        reads.push(ids);
        if (fail) throw new Error("read failed");
    } });
    visits.focus("a");
    visits.changed({ pages: [], blocks: ["X"] });
    assert.equal(await visits.settled("a"), false);
    assert.ok(locks.has("a"));
    assert.equal(errors.length, 1);
    fail = false;
    visits.focus(null); visits.focus("a");
    assert.ok(await visits.settled("a"));
    assert.ok(!locks.has("a"));
    assert.deepEqual(reads, [["X"], ["X"]]);
});

test("a failed departure protects the destination while the author can return and correct the unsaved change", async () => {
    const { visits, locks, page } = harness();
    let valid = false;
    await page("a", ["X"], { pending: () => true, flush: async () => valid });
    await page("b", ["X"]);
    visits.focus("a"); visits.focus("b");
    assert.equal(await visits.settled("b"), false);
    assert.ok(locks.has("b"));
    visits.focus("a");
    assert.ok(await visits.settled("a"));
    assert.ok(!locks.has("a"));
    valid = true;
    visits.focus("b");
    assert.ok(await visits.settled("b"));
    assert.ok(!locks.has("b"));
});

const date = { kind: "attribute", type: "day", id: "removed-date" };
const status = { kind: "attribute", type: "status", id: "removed-status" };
const pageRef = { kind: "page", id: "11111111-1111-4111-8111-111111111111" };
const savedViews = [
    { type: "page", params: { page: pageRef } },
    ...[true, false].map(showProperties => ({ type: "page", params: { page: pageRef, showProperties } })),
    { type: "page", params: { page: pageRef, fileId: pageRef.id, showProperties: false, infoWidth: 336, paperSidebar: "annotations" } },
    { type: "calendar", params: { date, start: { kind: "attribute", type: "minute", id: "start" }, status, agendaWidth: 346 } },
    { type: "trash", params: { ...defaultTrash(), infoWidth: 280 } },
    { type: "papers", params: { ...defaultTable("papers"), columns: [{ id: "paper_year", width: 92 }, { id: "title" }], showProperties: false, infoWidth: 332 } },
    { type: "library", params: { query: {
        conditions: [
            { field: { kind: "attribute", id: "missing" }, operator: "in", values: [{ kind: "current-page" }] },
            { field: { kind: "attribute", id: "missing-date" }, operator: "between", values: [
                { kind: "relative", period: "past-days", days: 30 }, { kind: "absolute", precision: "day", seconds: 0 }
            ] }
        ],
        sort: [{ field: { kind: "page-type" }, direction: "asc" }, { field: { kind: "title" }, direction: "desc" }],
        group: { field: { kind: "attribute", id: "missing-date" }, granularity: "week", collapsed: [null, 0] }
    } } },
    { type: "overview", params: { status, date } },
    { type: "feed", params: { scope: pageRef.id, read: "unread", order: "oldest", sourcesWidth: 200, listWidth: 340 } },
    { type: "feed", params: { scope: "followed" } },
    { type: "attributes", params: { listWidth: 275 } },
    ...["feed", "attributes", "settings", "about"].map(type => ({ type, params: {} }))
];
function layout(views: unknown[]): { groups: { id: string; tabs: { id: string; view: unknown }[]; activeTabId: string | null }[]; focusedGroupId: string; layout: { type: "group"; groupId: string } } {
    const tabs = views.map((view, i) => ({ id: String(i), view }));
    return { groups: [{ id: "A", tabs, activeTabId: tabs[0]?.id ?? null }], focusedGroupId: "A", layout: { type: "group", groupId: "A" } };
}
test("all view parameters round-trip independently of whether referenced objects exist", () => {
    const saved = layout(savedViews);
    assert.deepEqual(restoreTabState(saved), saved);
    assert.deepEqual(restoreTabState(layout([])), layout([]));
});
test("unknown views and invalid page locations discard only their tab and repair the active selection", () => {
    for (const bad of [
        { type: "future", params: {} },
        { type: "page", params: { page: { kind: "page", id: "invalid" } } },
        { type: "page", params: { page: pageRef, unexpected: "true" } }
    ]) {
        const saved = layout([bad, ...savedViews]);
        const restored = restoreTabState(saved);
        assert.deepEqual(restored?.groups[0].tabs, saved.groups[0].tabs.slice(1));
        assert.equal(restored?.groups[0].activeTabId, "1");
    }
});
test("invalid calendar parameters retain the tab with default dates and width", () => {
    for (const params of [{ date: status }, { date, agendaWidth: 0 }, { date, agendaWidth: "wide" }, { date, month: 123 }]) {
        const saved = layout([{ type: "calendar", params }]);
        assert.deepEqual(restoreTabState(saved), layout([{ type: "calendar", params: defaultCalendar }]));
    }
});
test("invalid overview and feed parameters keep the active tab and use defaults", () => {
    const saved = layout([{ type: "overview", params: { date: status } }, { type: "feed", params: { scope: "not-a-source", read: "unread" } }]);
    const restored = restoreTabState(saved);
    assert.equal(restored?.groups[0].activeTabId, "0");
    assert.deepEqual(restored?.groups[0].tabs.map(tab => tab.view), [
        { type: "overview", params: { status: { kind: "attribute", id: "task_status", type: "status" }, date: { kind: "attribute", id: "schedule_date", type: "day" } } },
        { type: "feed", params: {} }
    ]);
    const invalidScope = layout([{ type: "feed", params: { scope: "not-a-source" } }]);
    assert.deepEqual(restoreTabState(invalidScope)?.groups[0].tabs[0].view, { type: "feed", params: {} });
});
test("invalid attribute, settings and about parameters keep the tab and use defaults", () => {
    const cases = [
        { type: "attributes", params: { listWidth: 0 } },
        { type: "attributes", params: { listWidth: "wide" } },
        { type: "settings", params: null },
        { type: "about", params: { keyword: "A" } }
    ];
    for (const { type, params } of cases) {
        assert.deepEqual(restoreTabState(layout([{ type, params }])), layout([{ type, params: {} }]));
    }
});
test("invalid reader sidebar settings keep the page and its selected PDF", () => {
    const location = { page: pageRef, fileId: pageRef.id };
    for (const invalid of [{ infoWidth: 0 }, { showProperties: "true" }, { paperSidebar: "unknown" }]) {
        const saved = layout([{ type: "page", params: { ...location, showProperties: false, paperSidebar: "annotations", ...invalid } }]);
        assert.deepEqual(restoreTabState(saved)?.groups[0].tabs[0].view, { type: "page", params: location });
    }
});
test("invalid trash settings retain the tab with default parameters", () => {
    const saved = layout([{ type: "trash", params: { columns: [{ id: "kind" }], sort: "title" } }]);
    assert.deepEqual(restoreTabState(saved)?.groups[0].tabs[0].view, { type: "trash", params: defaultTrash() });
});
test("malformed column layouts, legacy sort strings and duplicate sorts restore table defaults", () => {
    const titleSort = { field: { kind: "title" }, direction: "asc" };
    for (const type of ["library", "papers"] as const) {
        for (const invalid of [{ columns: [{ id: "kind" }] }, { columns: [{ id: "title" }, { id: "title" }] }, { sort: "title" },
            { query: { conditions: [], sort: [titleSort, titleSort] } }, { query: { conditions: [{ field: { kind: "title" }, operator: "match" }], sort: [] } }]) {
            const saved = layout([{ type, params: { ...defaultTable(type), infoWidth: 283, ...invalid } }]);
            assert.deepEqual(restoreTabState(saved)?.groups[0].tabs[0].view, { type, params: defaultTable(type) });
        }
    }
});
test("the retired table type restores as a default library and papers drop only page-type settings", () => {
    const kind = { kind: "page-type" }, title = { kind: "title" };
    const column = { id: "title", width: 146 }, sort = { field: title, direction: "asc" };
    const filter = { field: title, operator: "contains", values: ["Alpha"] };
    const saved = layout([{ type: "table", params: { ...defaultTable("papers"), infoWidth: 410 } }, {
        type: "papers", params: { columns: [{ id: "kind" }, column], infoWidth: 281, query: {
            conditions: [{ field: kind, operator: "in", values: ["editable"] }, filter],
            sort: [{ field: kind, direction: "desc" }, sort], group: { field: kind, collapsed: ["paper"] }
        } }
    }]);
    assert.deepEqual(restoreTabState(saved), layout([{ type: "library", params: defaultTable() }, {
        type: "papers", params: { columns: [column], infoWidth: 281, query: { conditions: [filter], sort: [sort] } }
    }]));
});
test("broken layout relationships and the previous tab format use the default layout", () => {
    const saved = layout(savedViews);
    const leaf = saved.layout;
    for (const broken of [
        { ...saved, focusedGroupId: "B" }, { ...saved, groups: [...saved.groups, ...saved.groups] },
        { ...saved, layout: { type: "split", direction: "vertical", ratio: 0.5, children: [leaf, leaf] } },
        { ...saved, groups: [{ ...saved.groups[0], activeTabId: "absent" }] },
        { ...saved, groups: [{ ...saved.groups[0], tabs: [{ id: "0", type: "overview", title: "A" }] }] }
    ]) assert.equal(restoreTabState(broken), undefined);
});