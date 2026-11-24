import { type FailureInfo } from "../failure";

type FeedSourceStatus = "enabled" | "paused" | "cancelled";
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
    error: FailureInfo | null;
    unreadCount: number;
    refreshing: boolean;
    pinned: boolean;
};

/** What a source returned for one entry, before it is merged into saved items. */
export type FeedEntry = {
    externalId: string | null;
    title: string;
    url: string | null;
    pdfURL: string | null;
    authors: string;
    summary: string;
    /** Source markup, unsanitized. Empty when the source only has plain text. */
    content: string;
    /** False when the source only offered a summary. */
    fullContent: boolean;
    publishedAt: number | null;
};

export type FeedImport = { pageId: string; downloadPDF: boolean };
export type FeedDownload = { pageId: string; fileId: string };

export type FeedPosition = { progress: number };
export type FeedPaperState = "none" | "saved" | "recycled" | "missing";

export type FeedItem = {
    id: string;
    sourceId: string;
    sourceName: string;
    title: string;
    url: string | null;
    authors: string;
    publishedAt: number | null;
    isRead: boolean;
    paperId: string | null;
    paperState: FeedPaperState;
};

export type FeedItemDetail = FeedItem & {
    summary: string;
    content: string;
    fullContent: boolean;
    readingPosition: FeedPosition | null;
    pdfURL: string | null;
    pdfStatus: "idle" | "downloading" | "failed" | "saved";
    pdfFailure?: FailureInfo | null;
};

export type FeedRead = "all" | "unread" | "read";
export type FeedOrder = "newest" | "oldest";

export type FeedQuery = {
    sourceId?: string;
    keyword?: string;
    read?: FeedRead;
    order?: FeedOrder;
    /** Only items matching at least one followed keyword. */
    followed?: boolean;
    /** Preserve the open item when it no longer matches the same filters. */
    keep?: string;
};

export type FeedState = {
    sources: FeedSource[];
    ids: string[];
    items: FeedItem[];
    total: number;
    /** Unread items of every subscription that is not cancelled. */
    unreadCount: number;
    keywords: string[];
};

export const feedBatchSize = 96;
export const feedIntervals = { min: 15, max: 1440, default: 60 } as const;