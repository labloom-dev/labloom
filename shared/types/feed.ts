export type FeedSourceStatus = "enabled" | "paused" | "cancelled";
export type FeedSourceAction = "pause" | "resume" | "cancel";

export type FeedSourceInput = {
    id?: string;
    name: string;
    url: string;
    autoRefresh?: boolean;
    intervalMinutes?: number;
};

export type FeedSource = {
    id: string;
    name: string;
    url: string;
    status: FeedSourceStatus;
    autoRefresh: boolean;
    intervalMinutes: number;
    /** Time of the last successful fetch. */
    lastRefreshed: number | null;
    /** Time of the last attempt, successful or not. */
    lastChecked: number | null;
    nextRefresh: number | null;
    lastAdded: number;
    error: string | null;
    unreadCount: number;
    refreshing: boolean;
};

/** What a source returned for one entry, before it is merged into saved items. */
export type FeedEntry = {
    externalId: string | null;
    title: string;
    url: string | null;
    authors: string;
    summary: string;
    /** Source markup, unsanitized. Empty when the source only has plain text. */
    content: string;
    /** False when the source only offered a summary. */
    fullContent: boolean;
    publishedAt: number | null;
};

/** The address and identifier an item had when it was first fetched. */
export type FeedOrigin = { feedURL: string; externalId: string | null };
export type FeedPosition = { progress: number };
export type FeedPaperState = "none" | "saved" | "recycled" | "missing";

export type FeedItem = {
    id: string;
    sourceId: string;
    sourceName: string;
    title: string;
    url: string | null;
    authors: string;
    summary: string;
    publishedAt: number | null;
    isRead: boolean;
    paperId: string | null;
};

export type FeedItemDetail = FeedItem & {
    content: string;
    fullContent: boolean;
    readingPosition: FeedPosition | null;
    paperState: FeedPaperState;
};

export type FeedQuery = {
    sourceId?: string;
    keyword?: string;
    read?: "all" | "unread" | "read";
    order?: "newest" | "oldest";
    /** Only items matching at least one followed keyword. */
    followed?: boolean;
    offset?: number;
};

export type FeedState = {
    sources: FeedSource[];
    items: FeedItem[];
    total: number;
    /** Unread items of every subscription that is not cancelled. */
    unreadCount: number;
    keywords: string[];
};

export const feedPageSize = 50;
export const feedIntervals = { min: 15, max: 1440, default: 60 } as const;

export interface FeedAPI {
    getState: (query: FeedQuery) => Promise<FeedState>;
    getItem: (id: string) => Promise<FeedItemDetail>;
    saveSource: (source: FeedSourceInput) => Promise<string>;
    setSourceStatus: (id: string, action: FeedSourceAction) => Promise<void>;
    /** Resolves when the fetch finishes; failures are recorded on the source. */
    refresh: (sourceId?: string) => Promise<void>;
    setRead: (id: string, isRead: boolean) => Promise<void>;
    markAllRead: (sourceId?: string) => Promise<number>;
    setPosition: (id: string, progress: number) => Promise<void>;
    setKeywords: (keywords: string[]) => Promise<string[]>;
    /** Adds the item to the library and returns the paper page. */
    importItem: (id: string, replace?: boolean) => Promise<string>;
    openItem: (id: string) => Promise<void>;
    /** Background refreshes and other windows report changes here. */
    onChanged: (listener: () => void) => () => void;
}