import type { tags } from "typia";
import type { Language } from "../locale";
import type { PageQuery } from "../types/content";
import type { ViewParams } from "./views";

export type LibraryColumn = { id: string & tags.MinLength<1>; width?: number & tags.Minimum<44> };
export type LibrarySort = { column: string & tags.MinLength<1>; direction: "asc" | "desc" };
export type LibraryQuery = Omit<PageQuery, "sort" | "offset" | "limit"> & { sort: LibrarySort; language: Language };
export const libraryBatchSize = 64;
export type LibraryIndex = { ids: string[]; titles: string[]; names?: Record<string, string> };
export function defaultLibrary(papers = false): ViewParams["library"] {
    return { scope: "all", sort: { column: papers ? "created_at" : "modified_at", direction: "desc" }, tags: [], filters: [], ...(papers ? { paperOnly: true } : {}) };
}

export function defaultColumns(papers: boolean): LibraryColumn[] {
    return (papers ? ["title", "paper_authors", "paper_year", "paper_venue", "created_at"] : ["title", "kind", "tags", "modified_at"]).map(id => ({ id }));
}

export function repairLibraryFields(params: ViewParams["library"], attributes: ReadonlySet<string>): ViewParams["library"] {
    const validColumn = (id: string): boolean => id === "title" || id === "kind" || attributes.has(id);
    const columns = params.columns?.filter(column => validColumn(column.id));
    const filters = params.filters.filter(filter => attributes.has(filter.attribute.id));
    const validSort = validColumn(params.sort.column);
    if (columns?.length === params.columns?.length && filters.length === params.filters.length && validSort) return params;
    return { ...params, ...(columns ? { columns } : {}), filters,
        sort: validSort ? params.sort : defaultLibrary(params.paperOnly).sort };
}