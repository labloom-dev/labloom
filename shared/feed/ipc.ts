import type { FeedQuery, FeedSourceInput, FeedSourceAction, FeedState, FeedItemDetail } from "../types/feed";
import type { Channels } from "../ipc/contract";

export type FeedAPI = {
    getState(query: FeedQuery): Promise<FeedState>;
    getItem(id: string): Promise<FeedItemDetail>;
    saveSource(source: FeedSourceInput): Promise<string>;
    setSourceStatus(id: string, action: FeedSourceAction): Promise<void>;
    refresh(sourceId?: string): Promise<void>;
    setRead(id: string, isRead: boolean): Promise<void>;
    markAllRead(sourceId?: string): Promise<number>;
    setPosition(id: string, progress: number): Promise<void>;
    setKeywords(keywords: string[]): Promise<string[]>;
    importItem(id: string, replace?: boolean): Promise<string>;
    fetchPDF(id: string): Promise<void>;
    openItem(id: string): Promise<void>;
    onChanged(listener: () => void): () => void;
};

export const feedChannels = {
    getState: "feed:get-state",
    getItem: "feed:get-item",
    saveSource: "feed:save-source",
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