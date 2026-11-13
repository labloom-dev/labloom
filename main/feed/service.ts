import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, getTableColumns, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import {
    feedIntervals, feedPageSize,
    type FeedEntry, type FeedItemDetail, type FeedPaperState, type FeedQuery, type FeedSource, type FeedSourceAction, type FeedSourceInput, type FeedState
} from "../../shared/types/feed";
import { feedURL, normalizeURL } from "../../shared/utils/feed";
import { type WorkspaceDatabase } from "../storage/database";
import { feedItems, feedSources, workspaceMeta } from "../storage/tables";
import { FeedError, fetchFeed, type FeedRequest, type FeedResult } from "./parser";

export type FeedLoader = (request: FeedRequest) => Promise<FeedResult>;

export type FeedPaper = {
    title: string;
    authors: string;
    url: string | null;
    abstract: string;
    /** Publication day as YYYY-MM-DD. */
    published: string | null;
    /** Where the paper came from; kept with the page as its original source. */
    origin: Record<string, string | null>;
};

/** The paper library, as far as subscriptions need it. */
export type FeedLibrary = {
    /** Creates a paper page inside the caller's transaction and returns its id. */
    createPaper: (paper: FeedPaper) => string;
    paperState: (pageId: string) => Exclude<FeedPaperState, "none">;
    hasPDF?: (pageId: string) => boolean;
    importPDF?: (pageId: string, url: string) => Promise<void>;
    /** Called after the transaction commits, so open views can show the new page. */
    announce: (pageId: string) => void;
};

type SourceRow = typeof feedSources.$inferSelect;
type ItemRow = typeof feedItems.$inferSelect;

// Temporary failures are retried three times before waiting for the next interval.
const retryDelays = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
const concurrency = 4;
const maxKeywords = 50;
const abstractLimit = 4000;

/** Identifies an entry that has neither an identifier nor an address of its own. */
export function entryFingerprint(entry: Pick<FeedEntry, "title" | "authors" | "publishedAt">): string {
    const date = entry.publishedAt === null ? null : new Date(entry.publishedAt).toISOString();
    return createHash("sha256").update(JSON.stringify([entry.title, entry.authors, date])).digest("hex");
}

export class FeedService {
    /** Called whenever saved sources or items change, including during background refreshes. */
    onChanged?: () => void;
    private pending = new Map<string, Promise<void>>();
    private pdfDownloads = new Map<string, Promise<void>>();
    private pdfFailures = new Set<string>();
    private active = 0;
    private readonly waiting: (() => void)[] = [];

    constructor(
        private readonly database: WorkspaceDatabase,
        private readonly load: FeedLoader = fetchFeed,
        private readonly library?: FeedLibrary,
        private readonly now: () => number = Date.now
    ) {}

    getState(query: FeedQuery): FeedState {
        if (!query || typeof query !== "object"
            || (query.sourceId !== undefined && typeof query.sourceId !== "string")
            || (query.keyword !== undefined && typeof query.keyword !== "string")
            || (query.read !== undefined && !["all", "unread", "read"].includes(query.read))
            || (query.order !== undefined && !["newest", "oldest"].includes(query.order))
            || (query.followed !== undefined && typeof query.followed !== "boolean")
            || (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))) {
            throw new Error("无效的订阅查询。");
        }
        const rows = this.database.select({
            ...getTableColumns(feedSources),
            unreadCount: this.database.$count(feedItems, and(eq(feedItems.sourceId, feedSources.id), eq(feedItems.isRead, false)))
        }).from(feedSources).orderBy(feedSources.name, feedSources.id).all();
        const order = { enabled: 0, paused: 1, cancelled: 2 };
        const sources: FeedSource[] = rows.sort((a, b) => order[a.status] - order[b.status]).map(row => ({
            id: row.id,
            name: row.name,
            url: row.url,
            status: row.status,
            autoRefresh: row.autoRefresh,
            intervalMinutes: row.intervalMinutes,
            lastRefreshed: row.lastRefreshed,
            lastChecked: row.lastChecked,
            nextRefresh: row.nextRefresh,
            lastAdded: row.lastAdded,
            error: row.error,
            unreadCount: row.unreadCount,
            refreshing: this.pending.has(row.id)
        }));
        const keywords = this.keywords();
        const matches = (word: string): SQL => sql`instr(lower(${feedItems.title} || ' ' || ${feedItems.summary}), lower(${word})) > 0`;
        const keyword = query.keyword?.trim();
        const where = and(
            // A cancelled subscription keeps its history, shown only when it is selected.
            query.sourceId ? eq(feedItems.sourceId, query.sourceId) : ne(feedSources.status, "cancelled"),
            query.read === "unread" ? eq(feedItems.isRead, false) : query.read === "read" ? eq(feedItems.isRead, true) : undefined,
            keyword ? matches(keyword) : undefined,
            query.followed ? keywords.length ? or(...keywords.map(matches)) : sql`0` : undefined
        );
        const date = query.order === "oldest" ? asc(feedItems.publishedAt) : desc(feedItems.publishedAt);
        const items = this.database.select({
            id: feedItems.id,
            sourceId: feedItems.sourceId,
            sourceName: feedSources.name,
            title: feedItems.title,
            url: feedItems.url,
            authors: feedItems.authors,
            // Lists show an excerpt; the reader loads the whole item.
            summary: sql<string>`substr(${feedItems.summary}, 1, 400)`,
            publishedAt: feedItems.publishedAt,
            isRead: feedItems.isRead,
            paperId: feedItems.paperId
        }).from(feedItems).innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
            // Undated items stay at the end in either direction.
            .where(where).orderBy(sql`${feedItems.publishedAt} IS NULL`, date, feedItems.id).limit(feedPageSize).offset(query.offset ?? 0).all();
        const total = this.database.select({ count: count() }).from(feedItems)
            .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id)).where(where).get()!.count;
        const unreadCount = sources.reduce((sum, source) => sum + (source.status === "cancelled" ? 0 : source.unreadCount), 0);
        return { sources, items, total, unreadCount, keywords };
    }

    getItem(id: string): FeedItemDetail {
        const row = this.item(id);
        const source = this.database.select({ name: feedSources.name }).from(feedSources).where(eq(feedSources.id, row.sourceId)).get();
        return {
            id: row.id,
            sourceId: row.sourceId,
            sourceName: source?.name ?? "",
            title: row.title,
            url: row.url,
            authors: row.authors,
            summary: row.summary,
            publishedAt: row.publishedAt,
            isRead: row.isRead,
            paperId: row.paperId,
            content: row.content,
            fullContent: row.fullContent,
            readingPosition: row.readingPosition,
            paperState: this.paperState(row.paperId),
            pdfURL: row.pdfURL,
            pdfStatus: this.pdfDownloads.has(id) ? "downloading" : row.paperId && this.library?.hasPDF?.(row.paperId) ? "saved"
                : this.pdfFailures.has(id) ? "failed" : "idle"
        };
    }

    async saveSource(input: FeedSourceInput): Promise<string> {
        if (!input || typeof input.name !== "string" || typeof input.url !== "string"
            || (input.id !== undefined && typeof input.id !== "string")
            || (input.autoRefresh !== undefined && typeof input.autoRefresh !== "boolean")) throw new Error("无效的订阅来源。");
        const interval = input.intervalMinutes;
        if (interval !== undefined && (!Number.isSafeInteger(interval) || interval < feedIntervals.min || interval > feedIntervals.max)) {
            throw new Error(`自动刷新间隔应为 ${feedIntervals.min} 至 ${feedIntervals.max} 分钟。`);
        }
        let name = input.name.trim();
        if (name.length > 200 || input.url.length > 4096) throw new Error("名称最多 200 字符，订阅地址最多 4096 字符。");
        const url = feedURL(input.url);
        let existing = input.id ? this.source(input.id) : undefined;
        if (existing?.status === "cancelled") throw new Error("此订阅已取消，请先恢复订阅。");
        if (existing) this.duplicate(url, existing.id);
        // Subscribing again to a cancelled address continues that subscription and its history.
        else existing = this.duplicate(url);
        const revived = input.id === undefined && existing !== undefined;
        const id = existing?.id ?? randomUUID();
        const settings = {
            ...(input.autoRefresh === undefined ? {} : { autoRefresh: input.autoRefresh }),
            ...(interval === undefined ? {} : { intervalMinutes: interval })
        };
        if (existing && !revived && existing.url === url) {
            const nextRefresh = existing.lastChecked === null ? null : existing.lastChecked + (interval ?? existing.intervalMinutes) * 60000;
            this.database.update(feedSources).set({ name: name || existing.name, ...settings, ...(interval === undefined ? {} : { nextRefresh }) })
                .where(eq(feedSources.id, id)).run();
            this.onChanged?.();
            return id;
        }
        // Validate a new address before changing any saved configuration.
        const result = await this.load({ url, discover: true });
        if (!result.entries) throw new Error("来源没有返回订阅内容。");
        const address = feedURL(result.url);
        this.database.transaction(() => {
            // A web page may have led to a feed that is already subscribed.
            if (address !== url) this.duplicate(address, id);
            name ||= existing?.name || result.title.slice(0, 200) || new URL(address).hostname;
            if (existing) {
                this.source(id);
                this.database.update(feedSources).set({ name, url: address, ...settings, ...(revived ? { status: "enabled" as const } : {}) })
                    .where(eq(feedSources.id, id)).run();
            }
            else this.database.insert(feedSources).values({ id, name, url: address, ...settings }).run();
            this.store(this.source(id), result);
        });
        this.onChanged?.();
        return id;
    }

    setSourceStatus(id: string, action: FeedSourceAction): void {
        const source = this.source(id);
        if (action === "pause" && source.status === "enabled") this.database.update(feedSources).set({ status: "paused" }).where(eq(feedSources.id, id)).run();
        else if (action === "cancel" && source.status !== "cancelled") {
            this.database.update(feedSources).set({ status: "cancelled", error: null }).where(eq(feedSources.id, id)).run();
        }
        else if (action === "resume" && source.status !== "enabled") {
            // Due at once: content published while the source was inactive is fetched on the next check.
            this.database.update(feedSources).set({ status: "enabled", nextRefresh: null, failures: 0 }).where(eq(feedSources.id, id)).run();
        }
        else if (!["pause", "cancel", "resume"].includes(action)) throw new Error("无效的订阅操作。");
        this.onChanged?.();
    }

    async refresh(sourceId?: string): Promise<void> {
        if (sourceId !== undefined) {
            const source = this.source(sourceId);
            if (source.status !== "enabled") throw new Error(source.status === "paused" ? "此来源已暂停，恢复后才能刷新。" : "此订阅已取消，恢复订阅后才能刷新。");
            return this.refreshAll([source.id]);
        }
        return this.refreshAll(this.database.select({ id: feedSources.id }).from(feedSources).where(eq(feedSources.status, "enabled")).all().map(row => row.id));
    }

    /** Fetches every source whose automatic refresh is due. The application calls this on a timer. */
    async refreshDue(): Promise<void> {
        const due = this.database.select({ id: feedSources.id }).from(feedSources).where(and(
            eq(feedSources.status, "enabled"),
            eq(feedSources.autoRefresh, true),
            or(isNull(feedSources.nextRefresh), lte(feedSources.nextRefresh, this.now()))
        )).all();
        if (due.length) await this.refreshAll(due.map(row => row.id));
    }

    setRead(id: string, isRead: boolean): void {
        if (typeof id !== "string" || typeof isRead !== "boolean") throw new Error("无效的阅读状态。");
        if (!this.database.update(feedItems).set({ isRead }).where(eq(feedItems.id, id)).run().changes) {
            throw new Error("条目不存在。");
        }
        this.onChanged?.();
    }

    markAllRead(sourceId?: string): number {
        if (sourceId !== undefined) this.source(sourceId);
        const scope = sourceId !== undefined ? eq(feedItems.sourceId, sourceId)
            : sql`${feedItems.sourceId} IN (SELECT ${feedSources.id} FROM ${feedSources} WHERE ${feedSources.status} != 'cancelled')`;
        const { changes } = this.database.update(feedItems).set({ isRead: true }).where(and(scope, eq(feedItems.isRead, false))).run();
        if (changes) this.onChanged?.();
        return changes;
    }

    setPosition(id: string, progress: number): void {
        if (typeof id !== "string" || typeof progress !== "number" || !(progress >= 0 && progress <= 1)) throw new Error("无效的阅读位置。");
        this.database.update(feedItems).set({ readingPosition: { progress } }).where(eq(feedItems.id, id)).run();
    }

    setKeywords(keywords: string[]): string[] {
        if (!Array.isArray(keywords) || keywords.some(word => typeof word !== "string")) throw new Error("无效的关注关键词。");
        const unique = new Map<string, string>();
        for (const word of keywords) {
            const text = word.trim().replace(/\s+/g, " ");
            if (text.length > 100) throw new Error("每个关注关键词最多 100 字符。");
            if (text && !unique.has(text.toLowerCase())) unique.set(text.toLowerCase(), text);
        }
        if (unique.size > maxKeywords) throw new Error(`最多保存 ${maxKeywords} 个关注关键词。`);
        const saved = [...unique.values()];
        this.database.transaction(() => {
            const meta = this.database.select().from(workspaceMeta).get();
            if (!meta) throw new Error("请先打开工作区。");
            const feed = (meta.settings.feed ?? {}) as Record<string, unknown>;
            this.database.update(workspaceMeta).set({ settings: { ...meta.settings, feed: { ...feed, keywords: saved } } }).where(eq(workspaceMeta.id, meta.id)).run();
        });
        this.onChanged?.();
        return saved;
    }

    importItem(id: string, replace = false): string {
        const { library } = this;
        if (!library) throw new Error("当前环境不支持加入文献库。");
        const item = this.item(id);
        const state = this.paperState(item.paperId);
        if (state === "saved") return item.paperId!;
        // A recycled or missing page is never replaced by guessing; the reader confirms first.
        if (state !== "none" && !replace) throw new Error("关联的文献页已不在文献库中，确认后可以重新入库。");
        const source = this.database.select({ name: feedSources.name, url: feedSources.url }).from(feedSources).where(eq(feedSources.id, item.sourceId)).get();
        const pageId = this.database.transaction(() => {
            const page = library.createPaper({
                title: item.title,
                authors: item.authors,
                url: item.url,
                abstract: item.summary.length > abstractLimit ? `${item.summary.slice(0, abstractLimit)}…` : item.summary,
                published: item.publishedAt === null ? null : new Date(item.publishedAt).toISOString().slice(0, 10),
                origin: {
                    kind: "feed",
                    itemId: item.id,
                    sourceId: item.sourceId,
                    sourceName: source?.name ?? null,
                    feedURL: item.originSnapshot?.feedURL ?? source?.url ?? null,
                    externalId: item.externalId,
                    url: item.url
                }
            });
            this.database.update(feedItems).set({ paperId: page }).where(eq(feedItems.id, item.id)).run();
            return page;
        });
        library.announce(pageId);
        this.onChanged?.();
        if (item.pdfURL && library.importPDF) void this.fetchPDF(id);
        return pageId;
    }

    /** Reuses the same attempt across windows; errors belong to the item, never to paper creation. */
    fetchPDF(id: string): Promise<void> {
        const pending = this.pdfDownloads.get(id);
        if (pending) return pending;
        const item = this.item(id), library = this.library;
        if (!item.paperId || this.paperState(item.paperId) !== "saved") throw new Error("请先将条目加入文献库。");
        if (!item.pdfURL || !library?.importPDF) throw new Error("此条目没有可获取的 PDF。");
        if (library.hasPDF?.(item.paperId)) return Promise.resolve();
        const pageId = item.paperId, url = feedURL(item.pdfURL);
        this.pdfFailures.delete(id);
        // Defer the network work until the caller's paper transaction and IPC reply are complete.
        const attempt = Promise.resolve().then(() => library.importPDF!(pageId, url)).catch(() => {
            this.pdfFailures.add(id);
        }).finally(() => {
            this.pdfDownloads.delete(id);
            this.onChanged?.();
        });
        this.pdfDownloads.set(id, attempt);
        this.onChanged?.();
        return attempt;
    }

    itemURL(id: string): string {
        const { url } = this.item(id);
        if (!url) throw new Error("此条目没有可用的原文链接。");
        return feedURL(url);
    }

    private keywords(): string[] {
        const feed = this.database.select({ settings: workspaceMeta.settings }).from(workspaceMeta).get()?.settings.feed as { keywords?: unknown } | undefined;
        return Array.isArray(feed?.keywords) ? feed.keywords.filter((word): word is string => typeof word === "string") : [];
    }

    private paperState(paperId: string | null): FeedPaperState {
        if (!paperId) return "none";
        return this.library ? this.library.paperState(paperId) : "saved";
    }

    private item(id: string): ItemRow {
        if (typeof id !== "string") throw new Error("无效的条目。");
        const row = this.database.select().from(feedItems).where(eq(feedItems.id, id)).get();
        if (!row) throw new Error("条目不存在。");
        return row;
    }

    private source(id: string): SourceRow {
        if (typeof id !== "string") throw new Error("无效的订阅来源。");
        const source = this.database.select().from(feedSources).where(eq(feedSources.id, id)).get();
        if (!source) throw new Error("订阅来源不存在。");
        return source;
    }

    /**
     * Rejects an address that another source already uses. For a new subscription,
     * a cancelled source with the address is returned so it can be continued.
     */
    private duplicate(url: string, except?: string): SourceRow | undefined {
        const other = this.database.select().from(feedSources)
            .where(and(eq(feedSources.url, url), except ? ne(feedSources.id, except) : undefined)).get();
        if (other && (other.status !== "cancelled" || except)) throw new Error("这个订阅地址已经添加。");
        return other;
    }

    private async refreshAll(ids: string[]): Promise<void> {
        const requests = ids.map(id => {
            // Concurrent refreshes of one source share a single request.
            let request = this.pending.get(id);
            if (!request) {
                request = this.inTurn(() => this.refreshSource(id)).finally(() => {
                    this.pending.delete(id);
                    if (this.database.$client.open) this.onChanged?.();
                });
                this.pending.set(id, request);
            }
            return request;
        });
        // Views learn which sources are being fetched, queued ones included, before the first one finishes.
        if (requests.length) this.onChanged?.();
        await Promise.all(requests);
    }

    /** Lets a few requests run at a time, across manual and automatic refreshes together. */
    private async inTurn(run: () => Promise<void>): Promise<void> {
        if (this.active < concurrency) this.active++;
        else await new Promise<void>(resolve => this.waiting.push(resolve));
        try {
            await run();
        }
        finally {
            // A waiting request takes this one's place directly.
            const next = this.waiting.shift();
            if (next) next();
            else this.active--;
        }
    }

    private async refreshSource(id: string): Promise<void> {
        const requested = this.source(id);
        // Paused or cancelled while it waited its turn.
        if (requested.status !== "enabled") return;
        // A source changed while its request was in flight no longer wants this result.
        const current = (): SourceRow | undefined => {
            if (!this.database.$client.open) return undefined;
            const row = this.database.select().from(feedSources).where(eq(feedSources.id, id)).get();
            return row && row.status === "enabled" && row.url === requested.url ? row : undefined;
        };
        try {
            const result = await this.load({ url: requested.url, etag: requested.etag, lastModified: requested.lastModified });
            this.database.transaction(() => {
                const source = current();
                if (source) this.store(source, result);
            });
        }
        catch (error) {
            const source = current();
            if (!source) return;
            // Network failures all read alike to the user; the log keeps what went wrong. Addresses may carry private tokens, so only the host is recorded.
            if (error instanceof Error && error.cause !== undefined) console.warn(`Feed request to ${new URL(source.url).host} failed:`, error.cause);
            const failures = source.failures + 1;
            // Only failures the fetch layer marked as temporary are retried early; a format error will not fix itself.
            const retryable = error instanceof FeedError && error.retryable;
            const wait = retryable && failures <= retryDelays.length ? retryDelays[failures - 1] : source.intervalMinutes * 60000;
            const requestedWait = error instanceof FeedError ? error.retryAfter ?? 0 : 0;
            const now = this.now();
            this.database.update(feedSources).set({
                error: error instanceof Error && error.message ? error.message : "抓取失败，请重试。",
                lastAdded: 0,
                lastChecked: now,
                failures,
                // The source's own Retry-After always wins over a shorter local delay.
                nextRefresh: now + Math.max(wait, requestedWait)
            }).where(eq(feedSources.id, id)).run();
        }
    }

    private store(source: SourceRow, result: FeedResult): void {
        const added = result.entries ? this.merge(source, result.entries) : 0;
        const now = this.now();
        this.database.update(feedSources).set({
            lastRefreshed: now,
            lastChecked: now,
            lastAdded: added,
            error: null,
            failures: 0,
            nextRefresh: now + source.intervalMinutes * 60000,
            etag: result.etag,
            lastModified: result.lastModified
        }).where(eq(feedSources.id, source.id)).run();
    }

    /**
     * Saves fetched entries. An entry already saved keeps its id, read state, reading
     * position and paper; it is recognised by the source's identifier, then by its
     * address, then by its fingerprint.
     */
    private merge(source: SourceRow, entries: FeedEntry[]): number {
        const inSource = eq(feedItems.sourceId, source.id);
        const find = (condition: SQL): ItemRow[] => this.database.select().from(feedItems).where(and(inSource, condition)).all();
        let added = 0;
        for (const entry of entries) {
            const normalizedUrl = normalizeURL(entry.url);
            const fingerprint = entryFingerprint(entry);
            // Two identifiers that differ name two items, whatever else they share.
            const same = (row: ItemRow): boolean => entry.externalId === null || row.externalId === null;
            let saved = entry.externalId === null ? undefined : find(eq(feedItems.externalId, entry.externalId))[0];
            if (!saved && normalizedUrl) saved = find(eq(feedItems.normalizedUrl, normalizedUrl)).find(same);
            // Titles repeat, so a fingerprint only decides for entries that are dated or have no address.
            if (!saved && (entry.url === null || entry.publishedAt !== null)) saved = find(eq(feedItems.fingerprint, fingerprint)).find(same);
            // Before identifiers became optional, the address or fingerprint was saved in their place.
            if (!saved && entry.externalId === null) saved = find(eq(feedItems.externalId, entry.url ?? fingerprint))[0];
            if (!saved) {
                this.database.insert(feedItems).values({
                    ...entry,
                    id: randomUUID(),
                    sourceId: source.id,
                    normalizedUrl,
                    fingerprint,
                    originSnapshot: { feedURL: source.url, externalId: entry.externalId }
                }).run();
                added++;
                continue;
            }
            // Fill in what the saved item lacks and follow the source's corrections; personal state is untouched.
            this.database.update(feedItems).set({
                externalId: saved.externalId ?? entry.externalId,
                title: entry.title || saved.title,
                url: entry.url ?? saved.url,
                pdfURL: entry.pdfURL ?? saved.pdfURL,
                normalizedUrl: normalizedUrl ?? saved.normalizedUrl,
                fingerprint,
                authors: entry.authors || saved.authors,
                summary: entry.summary || saved.summary,
                content: entry.content || saved.content,
                fullContent: entry.content ? entry.fullContent : saved.fullContent,
                publishedAt: saved.publishedAt ?? entry.publishedAt
            }).where(eq(feedItems.id, saved.id)).run();
        }
        return added;
    }
}