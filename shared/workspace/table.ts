import type { tags } from "typia";
import type { AttributeDefinition } from "../types/attributes";
import { pageKinds, type PageKind, type PageSummary } from "../types/content";
import type { Language } from "../locale";
import type { uuid } from "../types/uuid";
import { conditionReady, fieldType, repairViewQuery, type GroupValue, type ViewField, type ViewQuery, type ViewSort } from "./query";

export type TableColumn = { id: string & tags.MinLength<1>; width?: number & tags.Minimum<44> };
type TableLayout = { columns?: TableColumn[]; showProperties?: boolean; infoWidth?: number & tags.Minimum<1> };
export type TableViewType = "library" | "papers";
export type TableParams = TableLayout & { query: ViewQuery };
export type TrashParams = TableLayout & { sort: ViewSort[] };
export type ViewLookup = { type: TableViewType; query: ViewQuery; keyword?: string; language: Language; session?: uuid; known?: uuid[] };
export type TrashLookup = Pick<ViewLookup, "keyword" | "language" | "session" | "known"> & { sort: ViewSort[] };
export type QueryGroup = { value: GroupValue; start: number; count: number };
export type ViewResult = { ids: string[]; titles: string[]; groups?: QueryGroup[]; names?: Record<string, string>; initial?: PageSummary[] };
export const tableBatchSize = 64;

export function columnField(id: string): ViewField {
    return id === "title" ? { kind: "title" } : id === "kind" ? { kind: "page-type" } : { kind: "attribute", id };
}

export function fieldColumn(field: ViewField): string {
    return field.kind === "attribute" ? field.id : field.kind === "title" ? "title" : "kind";
}

export function isTableView(type: string | undefined): type is TableViewType {
    return type === "library" || type === "papers";
}

export function defaultColumns(preset: TableViewType | "trash"): TableColumn[] {
    const ids = preset === "papers" ? ["title", "paper_authors", "paper_year", "paper_venue", "created_at"]
        : preset === "trash" ? ["title", "kind", "recycled_at"] : ["title", "kind", "tags", "modified_at"];
    return ids.map(id => ({ id }));
}

export function defaultTable(type: TableViewType = "library"): TableParams {
    return {
        columns: defaultColumns(type),
        query: { conditions: [], sort: [{ field: columnField(type === "papers" ? "created_at" : "modified_at"), direction: "desc" }] }
    };
}

export function defaultTrash(): TrashParams {
    return { columns: defaultColumns("trash"), sort: [{ field: columnField("recycled_at"), direction: "desc" }] };
}

export function allowedPageKinds(query: ViewQuery): PageKind[] {
    const conditions = query.conditions.filter(condition => condition.field.kind === "page-type" && conditionReady(condition));
    return pageKinds.filter(kind => conditions.every(({ operator, values }) => operator === "in" ? values.includes(kind) : !values.includes(kind)));
}

export function repairPaperQuery(query: ViewQuery): ViewQuery {
    const conditions = query.conditions.filter(item => item.field.kind !== "page-type"), sort = query.sort.filter(item => item.field.kind !== "page-type");
    const group = query.group?.field.kind === "page-type" ? undefined : query.group;
    return conditions.length === query.conditions.length && sort.length === query.sort.length && group === query.group ? query
        : { conditions, sort, ...(group ? { group } : {}) };
}

export function repairPaperFields(params: TableParams): TableParams {
    const columns = params.columns?.some(column => column.id === "kind") ? params.columns.filter(column => column.id !== "kind") : params.columns;
    const query = repairPaperQuery(params.query);
    return columns === params.columns && query === params.query ? params : { ...params, columns, query };
}

function repairColumns(columns: TableColumn[] | undefined, definitions: ReadonlyMap<string, AttributeDefinition>): TableColumn[] | undefined {
    const repaired = columns?.filter(column => !!fieldType(columnField(column.id), definitions));
    return repaired?.length === columns?.length ? columns : repaired;
}

export function repairTableFields(params: TableParams, definitions: ReadonlyMap<string, AttributeDefinition>, type: TableViewType): TableParams {
    if (type === "papers") params = repairPaperFields(params);
    const columns = repairColumns(params.columns, definitions), query = repairViewQuery(params.query, definitions);
    return columns === params.columns && query === params.query ? params : { ...params, columns, query };
}

export function repairTrashFields(params: TrashParams, definitions: ReadonlyMap<string, AttributeDefinition>): TrashParams {
    const columns = repairColumns(params.columns, definitions), sort = params.sort.filter(item => !!fieldType(item.field, definitions));
    return columns === params.columns && sort.length === params.sort.length ? params : { ...params, columns, sort };
}