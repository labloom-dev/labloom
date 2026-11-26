import type { GroupValue } from "../../../shared/workspace/query";
import type { ViewResult } from "../../../shared/workspace/table";

export type RetainedRow = { id: string; title: string; group?: GroupValue };
export type TablePage = RetainedRow & { kind: "page"; key: string };
export type TableGroup = { kind: "group"; key: string; value: GroupValue; count: number; collapsed: boolean; at: number; end: number };
type TableRow = TablePage | TableGroup;
export type TablePosition = { key?: string; id?: string; index: number; offset: number };

export type TableRows = {
    items: TableRow[];
    ids: Set<string>;
    positions: Map<string, number>;
    firstOccurrences: Map<string, number>;
    groups: Map<GroupValue, TableGroup>;
};

export function tableRows(result: ViewResult, grouped: boolean, collapsed: GroupValue[], retained: RetainedRow[]): TableRows {
    const items: TableRow[] = [], ids = new Set(result.ids), positions = new Map<string, number>(), firstOccurrences = new Map<string, number>();
    const groups = new Map<GroupValue, TableGroup>();
    const retainedIds = new Set(retained.map(row => row.id));
    for (const id of retainedIds) ids.add(id);
    function add(page: RetainedRow): void {
        const key = "p:" + JSON.stringify(page.group ?? null) + ":" + page.id;
        if (!firstOccurrences.has(page.id)) firstOccurrences.set(page.id, items.length);
        positions.set(key, items.length);
        items.push({ ...page, kind: "page", key });
    }
    if (!grouped) {
        retained.forEach(add);
        result.ids.forEach((id, i) => {
            if (!retainedIds.has(id)) add({ id, title: result.titles[i] });
        });
        return { items, ids, positions, firstOccurrences, groups };
    }
    const folded = new Set(collapsed), retainedByGroup = new Map<GroupValue, RetainedRow[]>();
    for (const row of retained) {
        const value = row.group ?? null, entries = retainedByGroup.get(value);
        if (entries) entries.push(row);
        else retainedByGroup.set(value, [row]);
    }
    const buckets = result.groups ?? [], bucketValues = new Set(buckets.map(group => group.value));
    const bounds = [...buckets, ...[...retainedByGroup.keys()].filter(value => !bucketValues.has(value)).map(value => ({ value, start: 0, count: 0 }))];
    for (const { value, start, count } of bounds) {
        const local = retainedByGroup.get(value) ?? [];
        let visible = local.length + count;
        if (retainedIds.size) {
            for (let i = start; i < start + count; i++) if (retainedIds.has(result.ids[i])) visible--;
        }
        if (!visible) continue;
        const key = "g:" + JSON.stringify(value), at = items.length;
        const header: TableGroup = { kind: "group", value, key, count: visible, collapsed: folded.has(value), at, end: at + 1 };
        positions.set(key, at);
        groups.set(value, header);
        items.push(header);
        if (header.collapsed) continue;
        local.forEach(row => add({ ...row, group: value }));
        for (let i = start; i < start + count; i++) {
            const id = result.ids[i];
            if (!retainedIds.has(id)) add({ id, title: result.titles[i], group: value });
        }
        header.end = items.length;
    }
    return { items, ids, positions, firstOccurrences, groups };
}