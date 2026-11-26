import { libraryText } from "../../shared/attrs/format";
import { attributeTargetKind, decodeValue, emptyValue, encodeValue } from "../../shared/attrs/values";
import { isTimeType, resolveTimeZone, secondsToDay, type TimePrecision } from "../../shared/content/time";
import { createI18n, type Translate } from "../../shared/i18n";
import type { Language } from "../../shared/locale";
import type { AttributeDefinition, AttributeValue } from "../../shared/types/attributes";
import { pageKinds, type PageKind } from "../../shared/types/content";
import { conditionReady, groupGranularity, repairViewQuery, type GroupValue, type QueryDate, type QueryOperator,
    type QueryValue, type ViewCondition, type ViewGroup, type ViewSort } from "../../shared/workspace/query";
import { dateBounds, dateGroup } from "../../shared/workspace/query-time";
import { repairPaperQuery, tableBatchSize, type QueryGroup, type TableViewType, type TrashLookup, type ViewLookup, type ViewResult } from "../../shared/workspace/table";
import * as workspace from "../workspace-state";
import { definitions } from "./attributes";
import { subscribe } from "./events";
import { statement, summariesForIds, summaryNames, targetNames, viewSearch } from "./records";

type Stored = string | number | null;
type Operand = Exclude<QueryValue, null>;
type Clause = { test: string; params: Stored[] };
type Row = { id: string; kind: PageKind; title: string; modified: number };
type QueryContext = { zone: string; now: number; language: Language; compare: Intl.Collator["compare"]; t: Translate };
type Definitions = ReadonlyMap<string, AttributeDefinition>;
type Values = Map<string, Map<string, Stored>>;
type Lookup = Omit<ViewLookup, "type"> & { type: TableViewType | "trash" };
type Projection = {
    criteria: string;
    rows: Map<string, Row>;
    values: Values;
    dirty: Set<string>;
    targetsChanged: boolean;
    search?: { term: string; ids: string[] };
};

const locale = createI18n("zh-CN");
const title = "knowledge_text(b.type,b.content)";
const withTitle = " CROSS JOIN blocks b ON b.id=p.title_block_id";
const withModified = " CROSS JOIN page_attrs m ON m.page_id=p.id AND m.attr_id='modified_at'";
const reverse: Partial<Record<QueryOperator, QueryOperator>> = {
    "not-contains": "contains", "not-equals": "equals", "not-in": "in", none: "any", empty: "not-empty"
};
const comparisons: Partial<Record<QueryOperator, string>> = { greater: ">", "greater-or-equal": ">=", less: "<", "less-or-equal": "<=" };
const scans = new Set<QueryOperator>(["contains", "not-contains", "any", "all", "none"]);

// One projection per mounted table. The workspace session releases all of them on close.
const projections = new Map<string, Projection>();
subscribe(event => {
    if (event.type !== "knowledge" || !projections.size) return;
    const { change } = event;
    if (change.definition) {
        projections.clear();
        return;
    }
    const affected = [...(change.summaryPages ?? change.pages), ...(change.recycledPages ?? []), ...(change.purged ?? [])];
    for (const projection of projections.values()) {
        for (const id of affected) projection.dirty.add(id);
        projection.search = undefined;
        projection.targetsChanged ||= !!(change.titlePages?.length || change.purged?.length);
    }
});

function timeTest(operator: QueryOperator, precision: TimePrecision, values: Operand[], { zone, now }: QueryContext): Clause {
    const ranges = (values as QueryDate[]).map(value => dateBounds(value, precision, zone, now));
    const min = (i: 0 | 1): number => ranges.reduce((result, range) => Math.min(result, range[i]), Infinity);
    const max = (i: 0 | 1): number => ranges.reduce((result, range) => Math.max(result, range[i]), -Infinity);
    switch (operator) {
        case "before": return { test: "a.value < ?", params: [max(0)] };
        case "after": return { test: "a.value >= ?", params: [min(1)] };
        case "on-or-after": return { test: "a.value >= ?", params: [min(0)] };
        case "on-or-before": return { test: "a.value < ?", params: [max(1)] };
        case "between": return { test: "a.value >= ? AND a.value < ?", params: [min(0), max(1)] };
        default: return ranges.length === 1 ? { test: "a.value >= ? AND a.value < ?", params: [...ranges[0]] }
            : { test: "EXISTS (SELECT 1 FROM json_each(?) q WHERE a.value >= q.value ->> 0 AND a.value < q.value ->> 1)", params: [JSON.stringify(ranges)] };
    }
}

function valueTest(operator: QueryOperator, expr: string, values: Operand[], def: AttributeDefinition | undefined, context: QueryContext): Clause {
    switch (operator) {
        case "not-empty": return { test: expr + " IS NOT ?", params: [def ? encodeValue(def, emptyValue(def.type)) : ""] };
        case "contains": {
            const terms = (values as string[]).map(value => value.trim().toLocaleLowerCase()).filter(Boolean);
            if (terms.length === 1) return { test: "instr(knowledge_lower(" + expr + "),?)>0", params: terms };
            return { test: "EXISTS (SELECT 1 FROM json_each(?) q WHERE instr(knowledge_lower(" + expr + "),q.value)>0)", params: [JSON.stringify(terms)] };
        }
        case "any": case "all": {
            const items = "SELECT value FROM json_each(" + expr + ")";
            if (values.length === 1) return { test: "? IN (" + items + ")", params: [values[0] as string] };
            const belongs = operator === "all" ? "NOT EXISTS" : "EXISTS";
            const membership = operator === "all" ? "NOT IN" : "IN";
            return { test: belongs + " (SELECT 1 FROM json_each(?) q WHERE q.value " + membership + " (" + items + "))", params: [JSON.stringify(values)] };
        }
        case "complete": case "incomplete": {
            const options = def?.metadata.options?.filter(option => option.group === operator).map(option => option.id) ?? [];
            return { test: expr + " IN (SELECT value FROM json_each(?))", params: [JSON.stringify(options)] };
        }
    }
    if (def && isTimeType(def.type)) return timeTest(operator, def.type, values, context);
    const cmp = comparisons[operator];
    if (cmp) {
        const aggregate = cmp.startsWith(">") ? Math.min : Math.max;
        return { test: expr + " " + cmp + " ?", params: [(values as number[]).reduce((a, b) => aggregate(a, b))] };
    }
    const encoded = def?.type === "boolean" ? values.map(Number) : values;
    return encoded.length === 1 ? { test: expr + " = ?", params: [encoded[0] as Stored] }
        : { test: expr + " IN (SELECT value FROM json_each(?))", params: [JSON.stringify(encoded)] };
}

function conditionClause(condition: ViewCondition, defs: Definitions, context: QueryContext, byId: boolean): Clause {
    const { field, operator } = condition;
    const values = condition.values.filter((value): value is Operand => value !== null);
    if (values.some(value => typeof value === "object" && value.kind === "current-page")) return { test: "0", params: [] };
    const def = field.kind === "attribute" ? defs.get(field.id) : undefined;
    const reversed = reverse[operator], expr = def ? "a.value" : field.kind === "title" ? title : "p.kind";
    const clause = valueTest(reversed ?? operator, expr, values, def, context);
    if (def) {
        const test = byId ? (reversed ? "NOT EXISTS" : "EXISTS") + " (SELECT 1 FROM page_attrs a WHERE a.page_id=p.id AND "
            : "p.id " + (reversed ? "NOT IN" : "IN") + " (SELECT a.page_id FROM page_attrs a WHERE ";
        return { test: test + "a.attr_id=? AND " + clause.test + ")", params: [def.id, ...clause.params] };
    }
    return reversed ? { ...clause, test: "NOT (" + clause.test + ")" } : clause;
}

function readRows(conditions: ViewCondition[], defs: Definitions, context: QueryContext, type: Lookup["type"], candidateIds?: string[]): Row[] {
    if (candidateIds?.length === 0) return [];
    const clauses = conditions.toSorted((a, b) => Number(scans.has(a.operator)) - Number(scans.has(b.operator)))
        .map(condition => ({ ...conditionClause(condition, defs, context, !!candidateIds || conditions.length > 1 && scans.has(condition.operator)),
            title: condition.field.kind === "title" }));
    const scope = (type === "papers" ? "p.kind='paper' AND " : "") +
        "EXISTS (SELECT 1 FROM page_attrs d WHERE d.page_id=p.id AND d.attr_id='deleted' AND d.value=" + Number(type === "trash") + ")";
    const source = (prior?: string[]): string => prior ? " FROM json_each(?) j CROSS JOIN pages p ON p.id=j.value" : " FROM pages p";
    const select = (part: typeof clauses, prior?: string[]): [string, Stored[]] => [
        "SELECT p.id" + source(prior) + (part.some(clause => clause.title) ? withTitle : "") + " WHERE " +
            [...part.map(clause => clause.test), scope].join(" AND "),
        [...(prior ? [JSON.stringify(prior)] : []), ...part.flatMap(clause => clause.params)]
    ];
    let matches = candidateIds;
    // Break up long expressions to stay within SQLite's expression-tree depth.
    const chunk = 32;
    let start = 0;
    for (; start + chunk < clauses.length; start += chunk) {
        const [sql, params] = select(clauses.slice(start, start + chunk), matches);
        matches = statement(sql).pluck().all(...params) as string[];
        if (!matches.length) return [];
    }
    const columns = "SELECT p.id,p.kind," + title + " AS title,m.value AS modified";
    if (start === clauses.length) return statement(columns + source(matches) + withTitle + withModified + " WHERE " + scope)
        .all(...(matches ? [JSON.stringify(matches)] : [])) as Row[];
    // Resolve membership through attribute indexes before decoding any selected titles.
    const [sql, params] = select(clauses.slice(start), matches);
    return statement("WITH candidates AS MATERIALIZED (" + sql + ") " + columns +
        " FROM candidates c CROSS JOIN pages p ON p.id=c.id" + withTitle + withModified).all(...params) as Row[];
}

function readValues(ids: string[], attrs: string[], into: Values): void {
    if (!ids.length || !attrs.length) return;
    const raw = statement("SELECT a.page_id AS id,a.attr_id AS attr,a.value FROM json_each(?) j CROSS JOIN page_attrs a ON a.page_id=j.value" +
        " WHERE a.attr_id IN (SELECT value FROM json_each(?))").all(JSON.stringify(ids), JSON.stringify(attrs)) as { id: string; attr: string; value: Stored }[];
    for (const { id, attr, value } of raw) into.get(attr)!.set(id, value);
}

function sortKey({ field }: ViewSort, defs: Definitions, values: Values, context: QueryContext): (row: Row) => string | number | null {
    if (field.kind === "title") return row => row.title || null;
    if (field.kind === "page-type") {
        const labels = Object.fromEntries(pageKinds.map(kind => [kind, context.t(`library.${kind}`)]));
        return row => labels[row.kind];
    }
    if (field.id === "modified_at") return row => row.modified;
    const def = defs.get(field.id)!, stored = values.get(field.id);
    if (!stored) return () => null;
    if (def.type === "number" || isTimeType(def.type)) return row => stored.get(row.id) as number | null ?? null;
    if (def.type === "string" || def.type === "url") return row => stored.get(row.id) as string | null || null;
    const decoded = new Map<Stored, AttributeValue>();
    for (const raw of stored.values()) if (raw !== null && !decoded.has(raw)) decoded.set(raw, decodeValue(def, raw));
    const names = attributeTargetKind(def.type) ? targetNames([...decoded.values()].map(value => [def, value])) : {};
    const labels = new Map([...decoded].map(([raw, value]) => [raw, libraryText(def, value, context.language, context.zone, context.t, names)]));
    return row => labels.get(stored.get(row.id) ?? null) || null;
}

function compareKeys(x: string | number | null, y: string | number | null, direction: ViewSort["direction"], compare: Intl.Collator["compare"]): number {
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const diff = typeof x === "number" && typeof y === "number" ? x - y : compare(String(x), String(y));
    return direction === "asc" ? diff : -diff;
}

function sortRows(rows: Row[], sorts: ViewSort[], defs: Definitions, values: Values, context: QueryContext): void {
    const keys = sorts.map(sort => sortKey(sort, defs, values, context));
    rows.sort((a, b) => {
        for (let i = 0; i < keys.length; i++) {
            const diff = compareKeys(keys[i](a), keys[i](b), sorts[i].direction, context.compare);
            if (diff) return diff;
        }
        return b.modified - a.modified || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

function grouped(rows: Row[], group: ViewGroup, defs: Definitions, values: Values, context: QueryContext, names: Record<string, string>): { rows: Row[]; groups: QueryGroup[] } {
    const { field, granularity } = group;
    const def = field.kind === "attribute" ? defs.get(field.id) : undefined;
    const options = def?.metadata.options?.slice() ?? [];
    if (def?.type === "status") options.sort((a, b) => Number(a.group === "complete") - Number(b.group === "complete"));
    const order: readonly GroupValue[] = field.kind === "page-type" ? pageKinds : def?.type === "boolean" ? [true, false] : options.map(option => option.id);
    const ranks = new Map(order.map((value, i) => [value, i]));
    const groups = new Map<GroupValue, Row[]>(options.map(option => [option.id, []]));
    const stored = def && values.get(def.id), keys = new Map<Stored, GroupValue[]>();
    function groupKeys(row: Row): GroupValue[] {
        if (field.kind === "page-type") return [row.kind];
        const raw = stored?.get(row.id);
        if (!def || raw == null) return [null];
        const cached = keys.get(raw);
        if (cached) return cached;
        const value = decodeValue(def, raw) as Exclude<GroupValue, null> | GroupValue[];
        const result = isTimeType(def.type) ? [dateGroup(value as number, def.type, groupGranularity(def.type, granularity), context.zone)]
            : Array.isArray(value) ? value.length ? value : [null] : [value];
        keys.set(raw, result);
        return result;
    }
    for (const row of rows) for (const value of groupKeys(row)) {
        let members = groups.get(value);
        if (!members) groups.set(value, members = []);
        members.push(row);
    }
    if (def?.type === "page-link" || def?.type === "page-links") {
        const ids = [...groups.keys()].filter((value): value is string => typeof value === "string");
        Object.assign(names, targetNames([[def, ids]]));
    }
    const ordered = [...groups].sort(([a], [b]) => {
        if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
        const rankA = ranks.get(a), rankB = ranks.get(b);
        if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
        if (typeof a === "number" && typeof b === "number") return a - b;
        const x = String(a), y = String(b);
        return context.compare(names[x] ?? x, names[y] ?? y) || (x < y ? -1 : x > y ? 1 : 0);
    });
    let start = 0;
    const bounds = ordered.map(([value, members]) => {
        const item = { value, start, count: members.length };
        start += members.length;
        return item;
    });
    return { rows: ordered.flatMap(([, members]) => members), groups: bounds };
}

function matchingRows(projection: Projection, keyword: string | undefined, scoped: boolean, zone: string): Row[] {
    const term = keyword?.trim().toLocaleLowerCase();
    if (!term || !projection.rows.size) return [...projection.rows.values()];
    const { search } = projection;
    if (search?.term !== term) {
        // A page matching a longer substring also had to match the shorter one.
        const candidates = search && term.includes(search.term) ? search.ids : scoped ? [...projection.rows.keys()] : undefined;
        const plan = viewSearch(term, zone, candidates)!;
        const ids = candidates?.length === 0 ? [] : (statement(plan.cte + "SELECT id FROM matches").pluck().all(plan.params) as string[])
            .filter(id => projection.rows.has(id));
        projection.search = { term, ids };
    }
    return projection.search!.ids.map(id => projection.rows.get(id)!);
}

function lookup(input: Lookup, columns?: string[]): ViewResult {
    const { type } = input;
    const zone = resolveTimeZone(workspace.timeZone()), { language } = input;
    const context: QueryContext = { zone, now: workspace.seconds(), language,
        compare: new Intl.Collator(language === "zh-CN" ? "zh-CN-u-co-pinyin" : language, { numeric: true }).compare,
        t: (key, options) => locale.t(key, { ...options, lng: language }) };
    const defs = new Map(definitions().map(def => [def.id, type === "trash" && def.id === "recycled_at" ? { ...def, hidden: false } : def]));
    const query = repairViewQuery(type === "papers" ? repairPaperQuery(input.query) : input.query, defs);
    const conditions = query.conditions.filter(conditionReady);
    const criteria = JSON.stringify([type, conditions, language, zone, secondsToDay(context.now, zone)]);
    let projection = input.session ? projections.get(input.session) : undefined;
    let known: Set<string> | undefined;
    const attrs = new Set(query.sort.flatMap(({ field }) => field.kind === "attribute" && field.id !== "modified_at" ? [field.id] : []));
    if (query.group?.field.kind === "attribute") attrs.add(query.group.field.id);
    if (projection?.criteria === criteria) {
        const { rows, values, dirty } = projection;
        if (input.known && !projection.targetsChanged) known = new Set(input.known.filter(id => !dirty.has(id)));
        for (const attr of values.keys()) if (!attrs.has(attr)) values.delete(attr);
        if (dirty.size) {
            const updated = readRows(conditions, defs, context, type, [...dirty]);
            for (const field of values.values()) for (const id of dirty) field.delete(id);
            readValues(updated.map(row => row.id), [...values.keys()], values);
            for (const id of dirty) rows.delete(id);
            for (const row of updated) rows.set(row.id, row);
        }
    }
    else {
        const rows = new Map(readRows(conditions, defs, context, type).map(row => [row.id, row]));
        projection = { criteria, rows, values: new Map(), dirty: new Set(), targetsChanged: false };
    }
    const rows = matchingRows(projection, input.keyword, type === "papers" || conditions.length > 0, zone);
    const { values } = projection, missing = [...attrs].filter(id => !values.has(id));
    if (missing.length) {
        const fields = new Map(missing.map(id => [id, new Map<string, Stored>()]));
        readValues(input.session ? [...projection.rows.keys()] : rows.map(row => row.id), missing, fields);
        for (const [id, field] of fields) values.set(id, field);
    }
    sortRows(rows, query.sort, defs, values, context);
    const links: [AttributeDefinition, AttributeValue][] = [];
    for (const condition of query.conditions) if (condition.field.kind === "attribute") {
        const def = defs.get(condition.field.id);
        if (def && attributeTargetKind(def.type) === "page") links.push([def, condition.values.filter(value => typeof value === "string")]);
    }
    const names = targetNames(links);
    const buckets = query.group && grouped(rows, query.group, defs, values, context, names);
    const ordered = buckets ? buckets.rows : rows;
    const groups = buckets ? buckets.groups : undefined;
    const result: ViewResult = { ids: ordered.map(row => row.id), titles: ordered.map(row => row.title), ...(groups ? { groups } : {}) };
    if (columns?.length && ordered.length) {
        const first = new Set<string>(), collapsed = new Set(query.group?.collapsed);
        for (const { start, count, value } of groups ?? [{ start: 0, count: ordered.length, value: null }]) {
            if (collapsed.has(value)) continue;
            for (let i = start; i < start + count && first.size < tableBatchSize; i++) first.add(ordered[i].id);
            if (first.size >= tableBatchSize) break;
        }
        const initial = summariesForIds([...first].filter(id => !known?.has(id)));
        Object.assign(names, summaryNames(initial, columns));
        result.initial = initial;
    }
    if (Object.keys(names).length) result.names = names;
    projection.dirty.clear();
    projection.targetsChanged = false;
    if (input.session) projections.set(input.session, projection);
    return result;
}

export function viewIndex(input: ViewLookup, columns?: string[]): ViewResult {
    return lookup(input, columns);
}

export function releaseView(session: string): void {
    projections.delete(session);
}

export function release(): void {
    projections.clear();
}

export function trashIndex({ sort, ...input }: TrashLookup, columns?: string[]): ViewResult {
    return lookup({ ...input, type: "trash", query: { sort, conditions: [] } }, columns);
}