import { type AttributeDefinition, type AttributeImpact, type AttributeValue } from "./attributes";
import { type Backlink, type CommitResult, type ContentBlock, type Mutation, type PageKind, type PageList, type PageQuery, type PageRecord, type Target } from "./content";

export type HistoryState = { canUndo: boolean; redo: { id: string; time: string }[] };
export type Notice = { id: string; pageId: string; title: string; createdAt: string; isRead: boolean };
export type KnowledgeAPI = {
    list(query?: PageQuery): Promise<PageList>;
    get(id: string): Promise<PageRecord>;
    create(kind: PageKind, title?: string, initial?: Record<string, AttributeValue>): Promise<PageRecord>;
    mutate(input: Mutation, token?: string): Promise<CommitResult>;
    definitions(): Promise<AttributeDefinition[]>;
    define(id: string, value: AttributeDefinition | null, token?: string): Promise<AttributeImpact | null>;
    backlinks(id: string): Promise<Backlink[]>;
    resolve(target: Target): Promise<{ title: string; text: string; deleted: boolean; block?: ContentBlock } | null>;
    history(tabId: string): Promise<HistoryState>;
    undo(tabId: string, direction: "undo" | "redo", branchId?: string): Promise<string>;
    closeTab(tabId: string): Promise<void>;
    loadTabs(): Promise<unknown>;
    saveTabs(value: unknown): Promise<void>;
    onChanged(listener: () => void): () => void;
    onCloseRequested(listener: () => Promise<boolean>): () => void;
};