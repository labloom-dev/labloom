export type FeedSourceInput = {
    id?: string;
    name: string;
    url: string;
};

export type FeedSource = {
    id: string;
    name: string;
    url: string;
    lastRefreshed: string | null;
    lastAdded: number;
    error: string | null;
    unreadCount: number;
};

export type FeedEntry = {
    externalId: string;
    title: string;
    url: string | null;
    authors: string;
    summary: string;
    publishedAt: string | null;
};

export type FeedItem = FeedEntry & {
    id: string;
    sourceId: string;
    sourceName: string;
    isRead: boolean;
};

export type FeedQuery = {
    sourceId?: string;
    keyword?: string;
    unreadOnly?: boolean;
    offset?: number;
};

export type FeedState = {
    sources: FeedSource[];
    items: FeedItem[];
    total: number;
};

export interface FeedAPI {
    getState: (query: FeedQuery) => Promise<FeedState>;
    saveSource: (source: FeedSourceInput) => Promise<string>;
    removeSource: (id: string) => Promise<void>;
    refresh: (sourceId?: string) => Promise<void>;
    setRead: (id: string, isRead: boolean) => Promise<void>;
    openItem: (id: string) => Promise<void>;
}