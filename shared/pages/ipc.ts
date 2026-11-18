import type { HistorySource } from "../history/ipc";
import type { AttributeValue } from "../types/attributes";
import type { Backlink, CommitResult, BlockDeletion, ChangePreview, ContentBlock, EditCommit, KnowledgeChange, Placement, ResolvedTarget, PageKind, PageList, PageQuery, PageRecord, PageObjects, Target } from "../types/content";
import type { PurgeResult } from "../types/knowledge";
import type { TabId, Channels } from "../ipc/contract";
import type { tags } from "typia";

export type PagesAPI = {
    list(query?: PageQuery): Promise<PageList>;
    listUpdates(query: PageQuery, unchanged: string[]): Promise<PageList & { order: string[] }>;
    get(id: string): Promise<PageRecord>;
    readObjects(pageId: string, ids: string[]): Promise<PageObjects>;
    syncBlocks(workspaceId: string, ids: string[] & tags.MinItems<1>): Promise<ContentBlock[] | null>;
    create(kind: PageKind, title?: string, initial?: Record<string, AttributeValue>, parentId?: string, tabId?: TabId): Promise<PageRecord>;
    commitEdit(input: EditCommit, source: HistorySource, confirmation?: string): Promise<CommitResult>;
    previewEdit(input: EditCommit): Promise<ChangePreview | null>;
    deleteBlock(input: BlockDeletion, source: HistorySource, confirmation?: string): Promise<CommitResult>;
    place(input: Placement, source: HistorySource, confirmation?: string): Promise<CommitResult>;
    trash(ids: string[], tabId: TabId, source: HistorySource, confirmation?: string): Promise<CommitResult>;
    restore(ids: string[], tabId: TabId, source: HistorySource): Promise<CommitResult>;
    purge(ids: string[], tabId: TabId, confirmation?: string): Promise<PurgeResult>;
    emptyTrash(tabId: TabId, confirmation?: string): Promise<PurgeResult>;
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