import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { releaseHandoffs, stagePaths } from "../main/attachments/service";
import { create, rename } from "../main/knowledge/edits";
import { purge } from "../main/knowledge/purge";
import { trashIndex, viewIndex } from "../main/knowledge/query";
import { builtinAttrs } from "../shared/attrs/builtins";
import { defaultMetadata } from "../shared/attrs/values";
import { dayToSeconds, secondsPerDay as day } from "../shared/content/time";
import { workspaceHistory } from "../shared/history/ipc";
import type { AttributeDefinition, AttributeMetadata, AttributeType, AttributeValue } from "../shared/types/attributes";
import { type TimePrecision } from "../shared/content/time";
import type { GroupValue, QueryDate, QueryOperator, QueryValue, ViewCondition, ViewField, ViewQuery } from "../shared/workspace/query";
import { dateBounds } from "../shared/workspace/query-time";
import { viewCreation } from "../shared/workspace/query-create";
import { columnField, repairTableFields, type TableParams, type TrashLookup, type ViewLookup } from "../shared/workspace/table";
import { historyServices, knowledgeServices, openTest } from "./support/session";

const absolute = (precision: TimePrecision, seconds: number): QueryDate => ({ kind: "absolute", precision, seconds });
const seconds = (text: string): number => Date.parse(text) / 1000;
const condition = (field: ViewField, operator: QueryOperator, ...values: QueryValue[]): ViewCondition => ({ field, operator, values });
function lookup(conditions: ViewCondition[], options: Partial<ViewQuery> = {}, keyword?: string): ReturnType<typeof viewIndex> {
    return viewIndex({ type: "library", language: "en", keyword, query: { conditions, sort: [], ...options } });
}
function fixture(t: TestContext, zone: () => string = () => "UTC", clock?: () => number): {
    service: ReturnType<typeof knowledgeServices>;
    define: (type: AttributeType, metadata?: AttributeMetadata) => string;
    definitions: () => Map<string, AttributeDefinition>;
    options: { id: string; name: string }[];
} {
    openTest(t, { timeZone: zone, clock });
    const service = knowledgeServices();
    const options = [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }, { id: "c", name: "Empty" }];
    function define(type: AttributeType, metadata = defaultMetadata(type)): string {
        const id = "custom:" + randomUUID();
        assert.equal(service.attributes.applyDefinition(id, { id, name: type, type, metadata }), null);
        return id;
    }
    const definitions = (): Map<string, AttributeDefinition> => new Map(service.attributes.definitions().map(def => [def.id, def]));
    return { service, define, definitions, options };
}

test("query operators use stored values, type-specific empties and incomplete operands", async t => {
    const { service, define, options } = fixture(t);
    const text = define("string"), url = define("url"), number = define("number"), logical = define("boolean"), json = define("json");
    const select = define("select", { options }), multi = define("multiselect", { options });
    const status = define("status", { options: options.map(option => ({ ...option, group: option.id === "b" ? "complete" : "incomplete" })) });
    const link = define("page-link"), links = define("page-links"), file = define("file"), files = define("files");
    service.attributes.applyDefinition("tags", { id: "tags", ...builtinAttrs.tags, metadata: { options } });
    const path = join(process.env.LABLOOM_TEST_ROOT!, "query-test.txt");
    writeFileSync(path, "A");
    const staged = await stagePaths([path], false, true);
    const fileId = staged.files[0].id;
    const a = service.create("editable", "Älpha Survey", { [text]: "ÄLPHA % literal", [url]: "https://alpha.example/A",
        [number]: 3, [logical]: true, [json]: { sample: 1 }, [select]: "a", [multi]: ["a", "b"], [status]: "a", [file]: fileId,
        [files]: [fileId], tags: ["a", "b"] });
    const b = service.create("paper", "Beta", { [text]: "BETA", [url]: "https://beta.example/", [number]: 9, [logical]: false,
        [select]: "b", [multi]: ["b"], [status]: "b", [link]: a.id, [links]: [a.id], tags: ["b"] });
    const c = service.create("editable", "", { [text]: "", [url]: "", [number]: null, [select]: null, [multi]: [], [status]: null,
        [link]: null, [links]: [], [file]: null, [files]: [], tags: [] });
    const d = service.create("feed", "Delta");
    service.attributes.write(a.id, { [link]: b.id, [links]: [a.id, b.id] });
    releaseHandoffs([fileId]);
    const pages = [a, b, c, d];
    function check(field: ViewField, operator: QueryOperator, values: QueryValue[], expected: number[]): void {
        const result = lookup([condition(field, operator, ...values)]);
        assert.deepEqual(new Set(result.ids), new Set(expected.map(i => pages[i].id)), JSON.stringify({ field, operator, values }));
    }
    for (const [id, term, exact] of [["title", " älpha ", a.title], [text, "älpha", "ÄLPHA % literal"], [url, "ExAmPlE/A", "https://alpha.example/A"]]) {
        const field = columnField(id), empty = id === "title" ? [2] : [2, 3];
        check(field, "contains", [term], [0]);
        check(field, "contains", [term, "beTa"], [0, 1]);
        check(field, "not-contains", [term], [1, 2, 3]);
        check(field, "equals", [exact], [0]);
        check(field, "not-equals", [exact], [1, 2, 3]);
        check(field, "empty", [], empty);
        check(field, "not-empty", [], [0, 1, 2, 3].filter(i => !empty.includes(i)));
        check(field, "contains", [null], [0, 1, 2, 3]);
    }
    check(columnField(text), "contains", ["%"], [0]);
    for (const [operator, values, expected] of [
        ["equals", [3, 9], [0, 1]], ["not-equals", [3], [1, 2, 3]], ["greater", [3], [1]],
        ["greater-or-equal", [3], [0, 1]], ["less", [9], [0]], ["less-or-equal", [9], [0, 1]],
        ["empty", [], [2, 3]], ["not-empty", [], [0, 1]], ["greater", [], [0, 1, 2, 3]]
    ] as const) check(columnField(number), operator, [...values], [...expected]);
    check(columnField(logical), "equals", [true], [0]);
    check(columnField(logical), "equals", [false], [1]);
    check(columnField(logical), "equals", [], [0, 1, 2, 3]);
    for (const [id, x, y] of [[select, "a", "b"], [status, "a", "b"], [link, b.id, a.id]]) {
        check(columnField(id), "in", [x], [0]);
        check(columnField(id), "in", [x, y], [0, 1]);
        check(columnField(id), "not-in", [x, y], [2, 3]);
        check(columnField(id), "empty", [], [2, 3]);
        check(columnField(id), "not-empty", [], [0, 1]);
        check(columnField(id), "in", [], [0, 1, 2, 3]);
    }
    check(columnField(status), "incomplete", [], [0]);
    check(columnField(status), "complete", [], [1]);
    for (const [id, x, y] of [[multi, "a", "b"], ["tags", "a", "b"], [links, b.id, a.id]]) {
        check(columnField(id), "any", [x, y], [0, 1]);
        check(columnField(id), "all", [x, y], [0]);
        check(columnField(id), "none", [x], [1, 2, 3]);
        check(columnField(id), "empty", [], [2, 3]);
        check(columnField(id), "not-empty", [], [0, 1]);
        check(columnField(id), "all", [], [0, 1, 2, 3]);
    }
    check(columnField("kind"), "in", ["editable", "paper"], [0, 1, 2]);
    check(columnField("kind"), "not-in", ["editable", "paper"], [3]);
    check(columnField("kind"), "not-in", [], [0, 1, 2, 3]);
    for (const id of [file, files, "feed_refresh"]) {
        const filled = id === "feed_refresh" ? 3 : 0;
        check(columnField(id), "not-empty", [], [filled]);
        check(columnField(id), "empty", [], [0, 1, 2, 3].filter(i => i !== filled));
    }
    check(columnField(link), "in", [{ kind: "current-page" }], []);
    check(columnField(links), "none", [{ kind: "current-page" }], []);
    check(columnField(json), "not-empty", [], [0, 1, 2, 3]);
    check(columnField("recycled_at"), "not-empty", [], [0, 1, 2, 3]);
    assert.deepEqual(lookup([condition(columnField(multi), "all", "a", "b"), condition(columnField(text), "contains", "ÄL")], {}, "SURVEY").ids, [a.id]);
    const long = Array.from({ length: 75 }, () => condition(columnField(text), "contains", "älpha"));
    assert.deepEqual(lookup(long).ids, [a.id]);
});

test("date operators compare each precision, including both endpoints and unfinished ranges", t => {
    const { service, define } = fixture(t);
    const a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C"), d = service.create("editable", "D");
    for (const precision of ["minute", "hour", "day", "month", "year"] as const) {
        const id = define(precision), field = columnField(id);
        const first = dayToSeconds("2024-01-01"), second = dayToSeconds("2026-01-01");
        const offset = precision === "hour" ? 1450 : precision === "minute" ? 59 : 0;
        service.attributes.write(a.id, { [id]: first + offset });
        service.attributes.write(b.id, { [id]: second + offset });
        service.attributes.write(c.id, { [id]: null });
        const x = absolute(precision, first), y = absolute(precision, second);
        for (const [operator, values, expected] of [
            ["equals", [x], [a.id]], ["equals", [x, y], [a.id, b.id]], ["before", [y], [a.id]], ["after", [x], [b.id]],
            ["on-or-after", [x], [a.id, b.id]], ["on-or-before", [y], [a.id, b.id]], ["between", [x, y], [a.id, b.id]],
            ["empty", [], [c.id, d.id]], ["not-empty", [], [a.id, b.id]], ["between", [null, y], [a.id, b.id, c.id, d.id]]
        ] as const) assert.deepEqual(new Set(lookup([condition(field, operator, ...values)]).ids), new Set(expected), precision + " " + operator);
    }
});

test("relative dates use fresh time, Monday and calendar boundaries in the application timezone", t => {
    let zone = "America/New_York", now = seconds("2026-12-31T23:30:00Z");
    t.mock.method(Date, "now", () => now * 1000);
    const { service, define } = fixture(t, () => zone), id = define("minute"), civil = define("day");
    const cases = [
        "2026-12-27T18:00:00Z", "2026-12-28T05:00:00Z", "2026-12-31T05:00:00Z", "2026-12-31T16:00:00Z",
        "2027-01-01T04:59:59Z", "2027-01-01T05:00:00Z", "2027-01-03T19:00:00Z", "2027-01-04T05:00:00Z"
    ];
    const pages = cases.map((text, i) => service.create("editable", String(i), { [id]: seconds(text), [civil]: dayToSeconds(text.slice(0, 10)) }));
    const eq = (value: QueryDate, expected: number[], field = id): void => {
        assert.deepEqual(new Set(lookup([condition(columnField(field), "equals", value)]).ids), new Set(expected.map(i => pages[i].id)));
    };
    const period = (period: Exclude<Extract<QueryDate, { kind: "relative" }>["period"], "past-days" | "next-days">): QueryDate => ({ kind: "relative", period });
    eq(period("today"), [2, 3, 4]);
    eq(period("yesterday"), []);
    eq(period("tomorrow"), [5]);
    eq(period("this-week"), [1, 2, 3, 4, 5, 6]);
    eq(period("last-week"), [0]);
    eq(period("next-week"), [7]);
    eq(period("this-month"), [0, 1, 2, 3, 4]);
    eq(period("last-month"), []);
    eq(period("next-month"), [5, 6, 7]);
    eq({ kind: "relative", period: "past-days", days: 4 }, [1, 2, 3, 4]);
    eq({ kind: "relative", period: "next-days", days: 2 }, [2, 3, 4, 5]);
    eq(absolute("day", dayToSeconds("2026-12-31")), [2, 3], civil);
    zone = "Asia/Singapore";
    eq(period("today"), [3, 4, 5]);
    eq(period("this-month"), [3, 4, 5, 6, 7]);
    eq(period("this-week"), [0, 1, 2, 3, 4, 5]);
    eq(absolute("day", dayToSeconds("2026-12-31")), [2, 3], civil);
    now += day;
    eq(period("today"), []);
    const dst = dateBounds(period("today"), "minute", "America/New_York", seconds("2026-03-08T16:00:00Z"));
    assert.deepEqual(dst, [seconds("2026-03-08T05:00:00Z"), seconds("2026-03-09T04:00:00Z")]);
});

test("group orders, empty option groups and duplicate membership preserve multi-level order", t => {
    const { service, define, options } = fixture(t);
    const multi = define("multiselect", { options }), select = define("select", { options }), number = define("number");
    const status = define("status", { options: options.map(option => ({ ...option, group: option.id === "b" ? "complete" : "incomplete" })) });
    const link = define("page-link"), links = define("page-links"), date = define("day");
    const monday = dayToSeconds("2026-01-05");
    const a = service.create("editable", "Beta", { [multi]: ["a", "b"], [select]: "a", [status]: "a", [number]: 2, pinned: true, [date]: monday + day });
    const b = service.create("paper", "Alpha", { [multi]: ["b"], [select]: "b", [status]: "b", [number]: 2, pinned: false, [date]: monday });
    const c = service.create("editable", "Gamma", { [multi]: ["a"], [select]: "a", [number]: 1, pinned: true, [date]: monday - day });
    const d = service.create("editable", "", { [multi]: [], [number]: null });
    service.attributes.write(a.id, { [link]: b.id, [links]: [a.id, b.id] });
    service.attributes.write(b.id, { [link]: a.id, [links]: [a.id] });
    const sort = [{ field: columnField(number), direction: "asc" }, { field: columnField("title"), direction: "desc" }] as const;
    const sorted = lookup([], { sort: [...sort] });
    assert.deepEqual(sorted.ids, [c.id, a.id, b.id, d.id]);
    function group(id: string, granularity?: "week"): [GroupValue, string[]][] | undefined {
        const result = lookup([], { sort: [...sort], group: { field: columnField(id), granularity, collapsed: [] } });
        return result.groups?.map(({ value, start, count }) => [value, result.ids.slice(start, start + count)]);
    }
    assert.deepEqual(group(multi), [["b", [a.id, b.id]], ["a", [c.id, a.id]], ["c", []], [null, [d.id]]]);
    assert.deepEqual(group(select), [["b", [b.id]], ["a", [c.id, a.id]], ["c", []], [null, [d.id]]]);
    assert.deepEqual(group(status), [["a", [a.id]], ["c", []], ["b", [b.id]], [null, [c.id, d.id]]]);
    assert.deepEqual(group("pinned"), [[true, [c.id, a.id]], [false, [b.id, d.id]]]);
    assert.deepEqual(group("kind"), [["editable", [c.id, a.id, d.id]], ["paper", [b.id]]]);
    assert.deepEqual(group(link), [[b.id, [a.id]], [a.id, [b.id]], [null, [c.id, d.id]]]);
    assert.deepEqual(group(links), [[b.id, [a.id]], [a.id, [a.id, b.id]], [null, [c.id, d.id]]]);
    assert.deepEqual(group(date, "week"), [[monday - 7 * day, [c.id]], [monday, [a.id, b.id]], [null, [d.id]]]);
    const first = viewIndex({ type: "library", language: "en", query: { conditions: [], sort: [...sort], group: { field: columnField(multi), collapsed: ["b"] } } }, ["title"]);
    assert.deepEqual(first.initial?.map(row => row.id), [c.id, a.id, d.id]);
});

test("deleted and retyped attributes repair only the settings that depend on them", t => {
    const { service, define, definitions, options } = fixture(t);
    const deleted = define("string"), changed = define("select", { options }), retained = define("number");
    const keep = condition(columnField(retained), "equals", 9);
    const params: TableParams = { columns: [{ id: "title" }, { id: deleted, width: 142 }, { id: changed, width: 90 }],
        showProperties: false, infoWidth: 335, query: {
            conditions: [condition(columnField(deleted), "contains", "abc"), condition(columnField(changed), "in", "a"), keep],
            sort: [{ field: columnField(changed), direction: "asc" }, { field: columnField(deleted), direction: "desc" }],
            group: { field: columnField(changed), collapsed: ["a"] }
        } };
    assert.equal(repairTableFields(params, definitions(), "library"), params);
    assert.equal(service.attributes.applyDefinition(deleted, null), null);
    assert.equal(service.attributes.applyDefinition(changed, { id: changed, name: "Number", type: "number", metadata: {} }), null);
    const repaired = repairTableFields(params, definitions(), "library");
    assert.deepEqual(repaired, { ...params, columns: [params.columns![0], params.columns![2]],
        query: { conditions: [keep], sort: [params.query.sort[0]] } });
    assert.equal(repairTableFields(repaired, definitions(), "library"), repaired);
});

test("papers apply their fixed scope with filters, search terms, sorting and grouping", t => {
    const { service, define, options } = fixture(t);
    const tag = define("multiselect", { options }), kept = { [tag]: ["a"] };
    const green = service.create("paper", "Green signal", kept);
    const amber = service.create("paper", "Amber signal", { [tag]: ["a", "b"] });
    service.create("paper", "Amber signal", { [tag]: ["b"] });
    service.create("paper", "Unrelated", kept);
    const note = service.create("editable", "Note about a signal", kept);
    const query: ViewQuery = { conditions: [condition(columnField(tag), "any", "a")],
        sort: [{ field: columnField("title"), direction: "asc" }], group: { field: columnField(tag), collapsed: [] } };
    const request = { query, language: "en", keyword: "signal" } as const;
    const result = viewIndex({ ...request, type: "papers" }, ["title"]);
    assert.deepEqual(result.ids, [amber.id, amber.id, green.id]);
    assert.deepEqual(result.groups, [{ value: "b", start: 0, count: 1 }, { value: "a", start: 1, count: 2 }, { value: "c", start: 3, count: 0 }]);
    assert.deepEqual(result.initial?.map(page => page.id), [amber.id, green.id]);
    assert.ok(viewIndex({ ...request, type: "library" }).ids.includes(note.id));
});

test("papers repair page-type fields without removing user criteria or layout", t => {
    const { service, definitions } = fixture(t);
    const paper = service.create("paper", "Alpha"), field = columnField("kind"), title = columnField("title");
    const keep = condition(title, "contains", "Alpha");
    const params: TableParams = { columns: [{ id: "title", width: 140 }, { id: "kind" }], infoWidth: 300, query: {
        conditions: [condition(field, "in", "editable"), keep],
        sort: [{ field, direction: "desc" }, { field: title, direction: "asc" }], group: { field, collapsed: ["paper"] }
    } };
    assert.equal(repairTableFields(params, definitions(), "library"), params);
    assert.deepEqual(repairTableFields(params, definitions(), "papers"), { ...params, columns: [params.columns![0]],
        query: { conditions: [keep], sort: [params.query.sort[1]] } });
    assert.deepEqual(viewIndex({ type: "papers", query: params.query, language: "en" }).ids, [paper.id]);
});

test("incremental paper lookups remove recycled pages and restore them without admitting notes", t => {
    const { service } = fixture(t);
    const paper = service.create("paper", "Paper signal"), note = service.create("editable", "Note signal");
    const input: ViewLookup = { type: "papers", language: "en", keyword: "signal", query: { conditions: [], sort: [] } };
    const cached = { ...input, session: randomUUID() };
    assert.deepEqual(viewIndex(cached).ids, [paper.id]);
    rename(note.id, "Note signal again", workspaceHistory);
    const preview = service.trash([paper.id], workspaceHistory);
    assert.equal(preview.status, "confirmation");
    service.trash([paper.id], workspaceHistory, preview.preview.token);
    const hidden = viewIndex(cached);
    assert.deepEqual(hidden.ids, []);
    assert.deepEqual(hidden, viewIndex(input));
    service.restore([paper.id], workspaceHistory);
    assert.deepEqual(viewIndex(cached), viewIndex(input));
    assert.deepEqual(viewIndex(cached).ids, [paper.id]);
});

test("refresh rechecks changed membership and ordering, with a full read across midnight", t => {
    let now = dayToSeconds("2026-11-26") + 12 * 3600;
    const { service, define, options } = fixture(t, () => "UTC", () => now * 1000);
    const field = define("day"), group = define("multiselect", { options });
    const today = dayToSeconds("2026-11-26");
    const a = service.create("editable", "A", { [field]: today, [group]: ["a", "b"] });
    const b = service.create("editable", "B", { [field]: today - day, [group]: ["b"] });
    const c = service.create("editable", "C", { [field]: today + day });
    const query: ViewQuery = {
        conditions: [condition(columnField(field), "equals", { kind: "relative", period: "today" })],
        sort: [{ field: columnField("title"), direction: "asc" }],
        group: { field: columnField(group), collapsed: ["a"] }
    };
    const request = { type: "library", query, language: "en" } as const;
    const cached = { ...request, session: randomUUID() };
    assert.deepEqual(viewIndex(cached).ids, [a.id, a.id]);
    service.attributes.write(a.id, { [field]: today - day });
    service.attributes.write(b.id, { [field]: today });
    assert.deepEqual(viewIndex(cached, ["title"]), viewIndex(request, ["title"]));
    now += day;
    assert.deepEqual(viewIndex(cached).ids, [c.id]);
    assert.deepEqual(viewIndex(cached, ["title"]), viewIndex(request, ["title"]));
});

test("a page edited in another tab invalidates cached text, sorting keys and group membership", t => {
    const { service, define, options } = fixture(t);
    const value = define("select", { options });
    const a = service.create("editable", "Alpha signal", { [value]: "a" }), b = service.create("editable", "Beta signal", { [value]: "b" });
    const request: ViewLookup = { type: "library", language: "en", keyword: "signal", query: { conditions: [],
        sort: [{ field: columnField("title"), direction: "asc" }], group: { field: columnField(value), collapsed: [] } } };
    const cached = { ...request, session: randomUUID() }, columns = ["title", value];
    const before = viewIndex(cached, columns);
    assert.deepEqual(before.ids, [b.id, a.id]);
    assert.equal(rename(a.id, "Revised signal", { kind: "page", id: a.id }).status, "saved");
    assert.equal(service.commitEdit({ pageId: a.id, batch: 0, blocks: [], detach: [value] }, { kind: "page", id: a.id }).status, "saved");
    const after = viewIndex(cached, columns);
    assert.deepEqual(after, viewIndex(request, columns));
    assert.deepEqual(after.titles, [b.title, "Revised signal"]);
    assert.equal(after.groups?.at(-1)?.value, null);
});

test("a changed attribute definition invalidates the cached result and search", t => {
    const { service, define, options } = fixture(t);
    const field = define("select", { options });
    const tagged = service.create("editable", "Tagged", { [field]: "a" });
    const request: ViewLookup = { type: "library", language: "en", keyword: "Alpha", query: { conditions: [],
        sort: [{ field: columnField(field), direction: "asc" }], group: { field: columnField(field), collapsed: [] } } };
    const cached = { ...request, session: randomUUID() };
    assert.deepEqual(viewIndex(cached).ids, [tagged.id]);
    const metadata = { options: options.map(option => option.id === "a" ? { ...option, name: "Orange" } : option) };
    assert.equal(service.attributes.applyDefinition(field, { id: field, name: "Tag", type: "select", metadata }), null);
    assert.deepEqual(viewIndex(cached).ids, []);
    assert.deepEqual(viewIndex(cached, [field]), viewIndex(request, [field]));
    assert.deepEqual(viewIndex({ ...cached, keyword: "Orange" }), viewIndex({ ...request, keyword: "Orange" }));
});

test("language changes use the same collation for already opened and fresh tables", t => {
    const { service } = fixture(t);
    const a = service.create("editable", "阿"), b = service.create("editable", "波");
    const request: ViewLookup = { type: "library", language: "en", query: { conditions: [], sort: [{ field: columnField("title"), direction: "asc" }] } };
    const cached = { ...request, session: randomUUID() };
    assert.deepEqual(viewIndex(cached).ids, [b.id, a.id]);
    const translated = { ...request, language: "zh-CN" } as const;
    const result = viewIndex({ ...translated, session: cached.session });
    assert.deepEqual(result.ids, [a.id, b.id]);
    assert.deepEqual(result, viewIndex(translated));
});

test("time-zone changes recalculate membership and grouping for an open table", t => {
    let zone = "UTC";
    const { service, define } = fixture(t, () => zone, () => seconds("2026-11-26T02:00:00Z") * 1000);
    const minute = define("minute"), field = columnField(minute);
    const a = service.create("paper", "A", { [minute]: seconds("2026-11-25T20:00:00Z") });
    const b = service.create("paper", "B", { [minute]: seconds("2026-11-26T10:00:00Z") });
    const request: ViewLookup = { type: "papers", language: "en", query: { conditions: [condition(field, "equals", { kind: "relative", period: "today" })],
        sort: [{ field, direction: "asc" }], group: { field, collapsed: [] } } };
    const cached = { ...request, session: randomUUID() };
    assert.deepEqual(viewIndex(cached).ids, [b.id]);
    zone = "America/Los_Angeles";
    assert.deepEqual(viewIndex(cached).ids, [a.id]);
    assert.deepEqual(viewIndex(cached, [minute]), viewIndex(request, [minute]));
});

test("permanent deletion invalidates the cached trash result", t => {
    const { service } = fixture(t);
    const page = service.create("paper", "Disposable signal");
    const preview = service.trash([page.id], workspaceHistory);
    assert.equal(preview.status, "confirmation");
    service.trash([page.id], workspaceHistory, preview.preview.token);
    const input: TrashLookup = { language: "en", keyword: "signal", sort: [] };
    const cached = { ...input, session: randomUUID() };
    assert.deepEqual(trashIndex(cached, ["title"]).ids, [page.id]);
    const removing = purge([page.id]);
    assert.equal(removing.status, "confirmation");
    assert.equal(purge([page.id], removing.token).status, "deleted");
    assert.deepEqual(trashIndex(cached, ["title"]).ids, []);
    assert.deepEqual(trashIndex(cached, ["title"]), trashIndex(input, ["title"]));
});

test("in-place creation writes inferred attributes and one undo, with cell edits in both histories", t => {
    const { service, define, definitions, options } = fixture(t);
    const tags = define("multiselect", { options }), status = define("status", { options: [{ id: "todo", name: "To do", group: "incomplete" }] });
    const date = define("day"), number = define("number"), text = define("string"), checked = define("boolean");
    const now = seconds("2026-12-31T20:00:00Z"), expectedDate = dayToSeconds("2027-01-01");
    const query: ViewQuery = {
        conditions: [condition(columnField("kind"), "in", "paper"), condition(columnField(tags), "any", "a"), condition(columnField(status), "in", "todo"),
            condition(columnField(date), "equals", { kind: "relative", period: "today" }), condition(columnField(checked), "equals", true),
            condition(columnField(text), "contains", "ignored"), condition(columnField(number), "between", 0, 5)],
        sort: [], group: { field: columnField(tags), collapsed: [] }
    };
    const { kind, initial } = viewCreation(query, definitions(), "Asia/Singapore", now, "b");
    assert.equal(kind, "paper");
    assert.deepEqual(initial, { [tags]: ["a", "b"], [status]: "todo", [date]: expectedDate, [checked]: true });
    const identity = { id: randomUUID(), writeId: randomUUID() };
    const page = create(workspaceHistory, "", initial, undefined, kind, identity);
    assert.equal(page.id, identity.id);
    assert.equal(page.title, "");
    for (const [id, value] of Object.entries(initial)) assert.deepEqual(page.attributes[id], value);
    const history = historyServices(), local = { kind: "page", id: page.id } as const;
    assert.equal(history.state(workspaceHistory).canUndo, true);
    history.apply(workspaceHistory, "undo");
    assert.equal(service.get(page.id).attributes.deleted, true);
    assert.equal(history.state(workspaceHistory).canUndo, false);
    history.apply(workspaceHistory, "redo");
    assert.equal(service.get(page.id).attributes.deleted, false);
    assert.equal(rename(page.id, "A", workspaceHistory).status, "saved");
    history.apply(workspaceHistory, "undo");
    assert.equal(service.get(page.id).title, "");
    history.apply(workspaceHistory, "redo");
    assert.equal(service.get(page.id).title, "A");
    assert.equal(history.state(local).canUndo, true);
    history.apply(local, "undo");
    assert.equal(service.get(page.id).title, "");

    const ambiguous = viewCreation({ conditions: [condition(columnField("kind"), "in", "editable", "paper"), condition(columnField(text), "equals", "A"),
        condition(columnField(text), "equals", "B"), condition(columnField(date), "before", absolute("day", expectedDate))], sort: [] },
        definitions(), "UTC", now);
    assert.deepEqual(ambiguous, { kind: "editable", initial: {} } satisfies { kind: string; initial: Record<string, AttributeValue> });
});