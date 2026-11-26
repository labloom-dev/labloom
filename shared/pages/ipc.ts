import type { HistorySource } from "../history/ipc";
import type { AttributeValue } from "../types/attributes";
import { type Backlink, type CommitResult, type BlockDeletion, type ContentBlock, type EditCommit, type KnowledgeChange, type Placement, type ResolvedTarget, type PageList, type PageQuery, type PageBlockList, type PageKind, type PageRecord, type PageObjects, type PageSearchResult, type Target } from "../types/content";
import type { PurgeResult } from "../types/knowledge";
import { type Channels } from "../ipc/contract";
import type { tags } from "typia";

import type { OverviewIndex, OverviewPage, OverviewQuery } from "../workspace/overview";
import type { CalendarPage, CalendarQuery } from "../workspace/calendar";
import type { uuid } from "../types/uuid";
import type { TrashLookup, ViewLookup, ViewResult } from "../workspace/table";

export type PagesAPI = {
    list(query?: PageQuery): Promise<PageList>;
    search(keyword: string, offset?: number, limit?: number): Promise<{ items: PageSearchResult[]; total: number }>;
    viewIndex(lookup: ViewLookup, initialColumns?: string[]): Promise<ViewResult>;
    releaseView(session: uuid): Promise<void>;
    trashIndex(lookup: TrashLookup, initialColumns?: string[]): Promise<ViewResult>;
    listUpdates(query: PageQuery, unchanged: string[], labelColumns?: string[]): Promise<PageList & { order: string[]; names?: Record<string, string> }>;
    overviewIndex(query: OverviewQuery): Promise<OverviewIndex>;
    overviewRows(ids: uuid[], date?: string): Promise<OverviewPage[]>;
    calendarRows(query: CalendarQuery): Promise<CalendarPage[]>;
    get(id: string): Promise<PageRecord>;
    blockList(id: string): Promise<PageBlockList>;
    readObjects(pageId: string, ids: string[]): Promise<PageObjects>;
    syncBlocks(workspaceId: string, ids: string[] & tags.MinItems<1>): Promise<ContentBlock[] | null>;
    create(source: HistorySource, title?: string, initial?: Record<string, AttributeValue>, parentId?: string, kind?: PageKind,
        identity?: { id: uuid; writeId: uuid }): Promise<PageRecord>;
    rename(id: string, title: string, source: HistorySource, confirmation?: string): Promise<CommitResult>;
    commitEdit(input: EditCommit, source: HistorySource, confirmation?: string, writeId?: string): Promise<CommitResult>;
    deleteBlock(input: BlockDeletion, source: HistorySource, confirmation?: string, writeId?: string): Promise<CommitResult>;
    place(input: Placement, source: HistorySource, confirmation?: string, writeId?: string): Promise<CommitResult>;
    trash(ids: string[], source: HistorySource, confirmation?: string, writeId?: string): Promise<CommitResult>;
    restore(ids: string[], source: HistorySource, writeId?: string): Promise<CommitResult>;
    purge(ids: string[], confirmation?: string): Promise<PurgeResult>;
    emptyTrash(confirmation?: string): Promise<PurgeResult>;
    backlinks(id: string): Promise<Backlink[]>;
    resolve(target: Target): Promise<ResolvedTarget | null>;
    onChanged(listener: (change: KnowledgeChange) => void): () => void;
};

export const pagesChannels = {
    list: "pages:list",
    search: "pages:search",
    viewIndex: "pages:view-index",
    releaseView: "pages:release-view",
    trashIndex: "pages:trash-index",
    listUpdates: "pages:list-updates",
    overviewIndex: "pages:overview-index",
    overviewRows: "pages:overview-rows",
    calendarRows: "pages:calendar-rows",
    get: "pages:get",
    blockList: "pages:block-list",
    readObjects: "pages:read-objects",
    syncBlocks: "pages:sync-blocks",
    create: "pages:create",
    rename: "pages:rename",
    commitEdit: "pages:commit-edit",
    deleteBlock: "pages:delete-block",
    place: "pages:place",
    trash: "pages:trash",
    restore: "pages:restore",
    purge: "pages:purge",
    emptyTrash: "pages:empty-trash",
    backlinks: "pages:backlinks",
    resolve: "pages:resolve"
} as const satisfies Channels<PagesAPI>;
export const pagesChanged = "pages:changed";