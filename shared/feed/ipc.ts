import type { FeedQuery, FeedSourceInput, FeedSourceAction, FeedState, FeedItemDetail, FeedImport, FeedDownload } from "../types/feed";
import type { Channels } from "../ipc/contract";

export type FeedAPI = {
    getState(query: FeedQuery): Promise<FeedState>;
    getItem(id: string): Promise<FeedItemDetail>;
    resolveSource(input: FeedSourceInput): Promise<string | null>;
    saveSource(resolution: string): Promise<string>;
    discardSource(resolution: string): Promise<void>;
    setSourceStatus(id: string, action: FeedSourceAction): Promise<void>;
    refresh(sourceId?: string): Promise<void>;
    setRead(id: string, isRead: boolean): Promise<void>;
    markAllRead(sourceId?: string): Promise<number>;
    setPosition(id: string, progress: number): Promise<void>;
    setKeywords(keywords: string[]): Promise<string[]>;
    importItem(id: string, replace?: boolean): Promise<FeedImport>;
    fetchPDF(id: string): Promise<FeedDownload | null>;
    openItem(id: string): Promise<void>;
    onChanged(listener: () => void): () => void;
};

export const feedChannels = {
    getState: "feed:get-state",
    getItem: "feed:get-item",
    resolveSource: "feed:resolve-source",
    saveSource: "feed:save-source",
    discardSource: "feed:discard-source",
    setSourceStatus: "feed:set-source-status",
    refresh: "feed:refresh",
    setRead: "feed:set-read",
    markAllRead: "feed:mark-all-read",
    setPosition: "feed:set-position",
    setKeywords: "feed:set-keywords",
    importItem: "feed:import-item",
    fetchPDF: "feed:fetch-pdf",
    openItem: "feed:open-item"
} as const satisfies Channels<FeedAPI>;
export const feedChanged = "feed:changed";