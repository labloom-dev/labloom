import type { HistorySource } from "../history/ipc";
import type { AttributeValue } from "../types/attributes";
import type { Backlink, CommitResult, BlockDeletion, ChangePreview, ContentBlock, EditCommit, KnowledgeChange, Placement, ResolvedTarget, PageList, PageQuery, PageRecord, PageObjects, Target } from "../types/content";
import type { PurgeResult } from "../types/knowledge";
import { type Channels } from "../ipc/contract";
import type { tags } from "typia";

export type PagesAPI = {
    list(query?: PageQuery): Promise<PageList>;
    listUpdates(query: PageQuery, unchanged: string[]): Promise<PageList & { order: string[] }>;
    get(id: string): Promise<PageRecord>;
    readObjects(pageId: string, ids: string[]): Promise<PageObjects>;
    syncBlocks(workspaceId: string, ids: string[] & tags.MinItems<1>): Promise<ContentBlock[] | null>;
    create(source: HistorySource, title?: string, initial?: Record<string, AttributeValue>, parentId?: string): Promise<PageRecord>;
    commitEdit(input: EditCommit, source: HistorySource, confirmation?: string, writeId?: string): Promise<CommitResult>;
    previewEdit(input: EditCommit): Promise<ChangePreview | null>;
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
    listUpdates: "pages:list-updates",
    get: "pages:get",
    readObjects: "pages:read-objects",
    syncBlocks: "pages:sync-blocks",
    create: "pages:create",
    commitEdit: "pages:commit-edit",
    previewEdit: "pages:preview-edit",
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