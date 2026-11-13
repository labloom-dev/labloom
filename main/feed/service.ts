import { LabloomError, toFailureInfo, type FailureInfo } from "../../shared/failure";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import {
    feedIntervals, feedPageSize,
    type FeedEntry, type FeedItemDetail, type FeedPaperState, type FeedQuery, type FeedSource, type FeedSourceAction, type FeedSourceInput, type FeedState
} from "../../shared/types/feed";
import { feedURL, normalizeURL } from "../../shared/utils/feed";
import { type WorkspaceDatabase } from "../storage/database";
import { feedItems, workspaceMeta } from "../storage/tables";
import { KnowledgeService } from "../knowledge/service";
import { EditHistory } from "../knowledge/history";
import { payload } from "../../shared/content/blocks";
import { recurrenceMinutes } from "../../shared/content/timers";
import { type AttributeValue } from "../../shared/types/attributes";
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

type SourceRow = Omit<FeedSource, "unreadCount" | "refreshing"> & { failures: number; etag: string | null; lastModified: string | null; deleted: boolean };
type Shared = { pending: Map<string, Promise<void>>; pdfDownloads: Map<string, Promise<void>>; pdfFailures: Map<string, FailureInfo>; active: number; waiting: (() => void)[] };
const shared = new WeakMap<object, Shared>();
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
    private currentKnowledge?: KnowledgeService;
    get knowledge(): KnowledgeService {
        if (!this.currentKnowledge) {
            this.currentKnowledge = new KnowledgeService(this.database, () => "system", this.now);
            new EditHistory(this.currentKnowledge);
        }
        return this.currentKnowledge;
    }
    private readonly state: Shared;
    private get pending(): Shared["pending"] {
 return this.state.pending;
}
    private get pdfDownloads(): Shared["pdfDownloads"] {
 return this.state.pdfDownloads;
}
    private get pdfFailures(): Shared["pdfFailures"] {
 return this.state.pdfFailures;
}
    constructor(
        private readonly database: WorkspaceDatabase,
        private readonly load: FeedLoader = fetchFeed,
        private readonly library?: FeedLibrary,
        private readonly now: () => number = Date.now
    ) {
        let state = shared.get(database.$client);
        if (!state) {
            state = { pending: new Map(), pdfDownloads: new Map(), pdfFailures: new Map(), active: 0, waiting: [] };
            shared.set(database.$client, state);
        }
        this.state = state;
    }

    private sources(includeDeleted = false): SourceRow[] {
        const ids = this.knowledge.statement("SELECT p.id FROM pages p JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted' WHERE p.kind='feed'" + (includeDeleted ? "" : " AND d.value=0")).pluck().all() as string[];
        const values = this.knowledge.valuesFor(ids);
        return ids.map(id => {
            const a = values.get(id)!, at = (key: string): number | null => typeof a[key] === "number" ? a[key] * 1000 : null;
            const next = this.knowledge.statement("SELECT due_at FROM timers WHERE page_id=? AND attr_id='feed_refresh' AND lead_seconds=0").pluck().get(id) as number | null | undefined;
            return { id, name: this.knowledge.title(id), url: String(a.feed_url), status: ["enabled", "paused", "cancelled"].includes(String(a.feed_status)) ? a.feed_status as SourceRow["status"] : "paused",
                autoRefresh: a.feed_refresh !== null, intervalMinutes: recurrenceMinutes(a.feed_refresh) ?? feedIntervals.default,
                lastRefreshed: at("feed_last_refreshed"), lastChecked: at("feed_last_checked"), nextRefresh: next == null ? null : next * 1000,
                lastAdded: Number(a.feed_last_added ?? 0), error: this.savedFailure(a.feed_error), failures: Number(a.feed_failures ?? 0),
                etag: a.feed_etag ? String(a.feed_etag) : null, lastModified: a.feed_last_modified ? String(a.feed_last_modified) : null, deleted: !!a.deleted };
        });
    }

    getState(query: FeedQuery): FeedState {
        if (!query || typeof query !== "object" || query.sourceId !== undefined && typeof query.sourceId !== "string" || query.keyword !== undefined && typeof query.keyword !== "string"
            || query.read !== undefined && !["all", "unread", "read"].includes(query.read) || query.order !== undefined && !["newest", "oldest"].includes(query.order)
            || query.followed !== undefined && typeof query.followed !== "boolean" || query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0)) throw new LabloomError({ kind: "feed-invalid-query" });
        const order = { enabled: 0, paused: 1, cancelled: 2 };
        const sources: FeedSource[] = this.sources().sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(({ failures: _failures, etag: _etag, lastModified: _modified, deleted: _deleted, ...row }) => ({
            ...row, unreadCount: this.knowledge.statement("SELECT count(*) FROM feed_items WHERE source_id=? AND is_read=0").pluck().get(row.id) as number, refreshing: this.pending.has(row.id)
        }));
        const keywords = this.keywords(), where = ["d.value=0"], args: (string | number)[] = [];
        if (query.sourceId) {
 where.push("i.source_id=?"); args.push(query.sourceId);
}
        else where.push("s.value IS NOT 'cancelled'");
        if (query.read && query.read !== "all") {
 where.push("i.is_read=?"); args.push(Number(query.read === "read"));
}
        const match = "instr(lower(i.title || ' ' || i.summary),lower(?))>0";
        if (query.keyword?.trim()) {
 where.push(match); args.push(query.keyword.trim());
}
        if (query.followed) {
            where.push(keywords.length ? "(" + keywords.map(() => match).join(" OR ") + ")" : "0"); args.push(...keywords);
        }
        const from = ` FROM feed_items i JOIN pages p ON p.id=i.source_id JOIN blocks b ON b.id=p.title_block_id
            JOIN page_attrs s ON s.page_id=p.id AND s.attr_id='feed_status' JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted' WHERE ` + where.join(" AND ");
        const rows = this.knowledge.statement(`SELECT i.id,i.source_id AS sourceId,knowledge_text(b.type,b.content) AS sourceName,i.title,i.url,i.authors,
            substr(i.summary,1,400) AS summary,i.published_at AS publishedAt,i.is_read AS isRead,i.paper_id AS paperId` + from +
            ` ORDER BY i.published_at IS NULL,i.published_at ${query.order === "oldest" ? "ASC" : "DESC"},i.id LIMIT ? OFFSET ?`).all(...args, feedPageSize, query.offset ?? 0) as FeedState["items"];
        const items = rows.map(row => ({ ...row, isRead: !!row.isRead }));
        return { sources, items, total: this.knowledge.statement("SELECT count(*)" + from).pluck().get(...args) as number,
            unreadCount: sources.reduce((sum, source) => sum + (source.status === "cancelled" ? 0 : source.unreadCount), 0), keywords };
    }

    getItem(id: string): FeedItemDetail {
        const row = this.item(id), source = this.source(row.sourceId);
        return { id: row.id, sourceId: row.sourceId, sourceName: source.name, title: row.title, url: row.url, authors: row.authors, summary: row.summary,
            publishedAt: row.publishedAt, isRead: row.isRead, paperId: row.paperId, content: row.content, fullContent: row.fullContent, readingPosition: row.readingPosition,
            paperState: this.paperState(row.paperId), pdfURL: row.pdfURL,
            pdfStatus: this.pdfDownloads.has(id) ? "downloading" : row.paperId && this.library?.hasPDF?.(row.paperId) ? "saved" : this.pdfFailures.has(id) ? "failed" : "idle", pdfFailure: this.pdfFailures.get(id) ?? null };
    }

    private updateSource(id: string, name: string, values: Record<string, AttributeValue>): void {
        const page = this.knowledge.get(id), title = page.blocks[page.titleBlockId];
        this.knowledge.commitEdit({ pageId: id, tabId: "feed-settings", batch: 0, blocks: name === page.title ? [] : [{ ...title, payload: payload("title", name) }], attributes: values });
        this.knowledge.invalidateHistory(["page:" + id, "block:" + page.titleBlockId]);
    }

    async saveSource(input: FeedSourceInput): Promise<string> {
        if (!input || typeof input.name !== "string" || typeof input.url !== "string" || input.id !== undefined && typeof input.id !== "string" || input.autoRefresh !== undefined && typeof input.autoRefresh !== "boolean") throw new LabloomError({ kind: "feed-invalid-source" });
        const interval = input.intervalMinutes;
        if (interval !== undefined && (!Number.isSafeInteger(interval) || interval < feedIntervals.min || interval > feedIntervals.max)) throw new LabloomError({ kind: "feed-invalid-interval" });
        let name = input.name.trim();
        if (name.length > 200 || input.url.length > 4096) throw new LabloomError({ kind: "feed-source-too-long" });
        const url = feedURL(input.url);
        let existing = input.id ? this.source(input.id) : undefined;
        if (existing?.status === "cancelled") throw new LabloomError({ kind: "feed-cancelled" });
        if (existing) this.duplicate(url, existing.id);
        else existing = this.duplicate(url);
        const revived = input.id === undefined && existing !== undefined;
        const refresh = input.autoRefresh ?? existing?.autoRefresh ?? true;
        const values = { feed_url: url, feed_refresh: refresh ? { every: interval ?? existing?.intervalMinutes ?? feedIntervals.default, unit: "minute" } : null };
        if (existing && !revived && existing.url === url) {
            this.updateSource(existing.id, name || existing.name, values); this.onChanged?.(); return existing.id;
        }
        const result = await this.load({ url, discover: true });
        if (!result.entries) throw new LabloomError({ kind: "feed-empty" });
        const address = feedURL(result.url);
        const id = this.knowledge.transaction(() => {
            const duplicate = this.duplicate(address, existing?.id);
            if (duplicate && duplicate.id !== existing?.id) throw new LabloomError({ kind: "feed-duplicate" });
            name ||= existing?.name || result.title.slice(0, 200) || new URL(address).hostname;
            let id: string;
            if (existing) {
                this.source(existing.id);
                this.updateSource(existing.id, name, { ...values, feed_url: address, ...(revived ? { feed_status: "enabled" } : {}) });
                id = existing.id;
            }
            else id = this.knowledge.create("feed", name, { ...values, feed_url: address }).id;
            this.store(this.source(id), result);
            return id;
        });
        this.knowledge.onChanged?.({ sourceTab: "", pages: [id], blocks: [] });
        this.onChanged?.(); return id;
    }

    setSourceStatus(id: string, action: FeedSourceAction): void {
        const source = this.source(id);
        if (!["pause", "cancel", "resume"].includes(action)) throw new LabloomError({ kind: "feed-invalid-action" });
        const status = action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "enabled";
        if (source.status !== status) this.updateSource(id, source.name, { feed_status: status });
        if (action === "cancel") this.knowledge.attributes.cache(id, { feed_error: "" });
        this.onChanged?.();
    }

    async refresh(sourceId?: string): Promise<void> {
        if (sourceId !== undefined) {
            const source = this.source(sourceId);
            if (source.status !== "enabled") throw new LabloomError({ kind: source.status === "paused" ? "feed-paused" : "feed-cancelled-refresh" });
            return this.refreshAll([source.id]);
        }
        return this.refreshAll(this.sources().filter(source => source.status === "enabled").map(row => row.id));
    }

    async refreshDue(): Promise<void> {
        await this.knowledge.timers.check(() => {}, id => this.refresh(id));
    }

    setRead(id: string, isRead: boolean): void {
        if (typeof id !== "string" || typeof isRead !== "boolean") throw new LabloomError({ kind: "feed-invalid-read-state" });
        if (!this.database.update(feedItems).set({ isRead }).where(eq(feedItems.id, id)).run().changes) {
            throw new LabloomError({ kind: "feed-item-missing" });
        }
        this.onChanged?.();
    }

    markAllRead(sourceId?: string): number {
        if (sourceId !== undefined) this.source(sourceId);
        const scope = sourceId !== undefined ? eq(feedItems.sourceId, sourceId)
            : sql`${feedItems.sourceId} IN (SELECT p.id FROM pages p JOIN page_attrs s ON s.page_id=p.id AND s.attr_id='feed_status' JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted' WHERE p.kind='feed' AND s.value IS NOT 'cancelled' AND d.value=0)`;
        const { changes } = this.database.update(feedItems).set({ isRead: true }).where(and(scope, eq(feedItems.isRead, false))).run();
        if (changes) this.onChanged?.();
        return changes;
    }

    setPosition(id: string, progress: number): void {
        if (typeof id !== "string" || typeof progress !== "number" || !(progress >= 0 && progress <= 1)) throw new LabloomError({ kind: "feed-invalid-position" });
        this.database.update(feedItems).set({ readingPosition: { progress } }).where(eq(feedItems.id, id)).run();
    }

    setKeywords(keywords: string[]): string[] {
        if (!Array.isArray(keywords) || keywords.some(word => typeof word !== "string")) throw new LabloomError({ kind: "feed-invalid-keywords" });
        const unique = new Map<string, string>();
        for (const word of keywords) {
            const text = word.trim().replace(/\s+/g, " ");
            if (text.length > 100) throw new LabloomError({ kind: "feed-keyword-too-long" });
            if (text && !unique.has(text.toLowerCase())) unique.set(text.toLowerCase(), text);
        }
        if (unique.size > maxKeywords) throw new LabloomError({ kind: "feed-too-many-keywords" });
        const saved = [...unique.values()];
        this.database.transaction(() => {
            const meta = this.database.select().from(workspaceMeta).get();
            if (!meta) throw new LabloomError({ kind: "workspace-not-ready" });
            const feed = (meta.settings.feed ?? {}) as Record<string, unknown>;
            this.database.update(workspaceMeta).set({ settings: { ...meta.settings, feed: { ...feed, keywords: saved } } }).where(eq(workspaceMeta.id, meta.id)).run();
        });
        this.onChanged?.();
        return saved;
    }

    importItem(id: string, replace = false): string {
        const { library } = this;
        if (!library) throw new LabloomError({ kind: "feed-library-unavailable" });
        const item = this.item(id);
        const state = this.paperState(item.paperId);
        if (state === "saved") return item.paperId!;
        // A recycled or missing page is never replaced by guessing; the reader confirms first.
        if (state !== "none" && !replace) throw new LabloomError({ kind: "feed-reimport-confirmation" });
        const source = this.source(item.sourceId);
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
        if (!item.paperId || this.paperState(item.paperId) !== "saved") throw new LabloomError({ kind: "feed-paper-required" });
        if (!item.pdfURL || !library?.importPDF) throw new LabloomError({ kind: "feed-no-pdf" });
        if (library.hasPDF?.(item.paperId)) return Promise.resolve();
        const pageId = item.paperId, url = feedURL(item.pdfURL);
        this.pdfFailures.delete(id);
        // Defer the network work until the caller's paper transaction and IPC reply are complete.
        const attempt = Promise.resolve().then(() => library.importPDF!(pageId, url)).catch(error => {
            console.error("Feed PDF import failed", error);
            this.pdfFailures.set(id, toFailureInfo(error));
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
        if (!url) throw new LabloomError({ kind: "feed-no-url" });
        return feedURL(url);
    }

    private keywords(): string[] {
        const feed = this.database.select({ settings: workspaceMeta.settings }).from(workspaceMeta).get()?.settings.feed as { keywords?: unknown } | undefined;
        return Array.isArray(feed?.keywords) ? feed.keywords.filter((word): word is string => typeof word === "string") : [];
    }

    private savedFailure(value: AttributeValue): FailureInfo | null {
        if (!value) return null;
        try {
            return toFailureInfo(JSON.parse(String(value)));
        }
        catch {
            return { kind: "unexpected", diagnostic: String(value) };
        }
    }

    private paperState(paperId: string | null): FeedPaperState {
        if (!paperId) return "none";
        return this.library ? this.library.paperState(paperId) : "saved";
    }

    private item(id: string): ItemRow {
        if (typeof id !== "string") throw new LabloomError({ kind: "feed-invalid-item" });
        const row = this.database.select().from(feedItems).where(eq(feedItems.id, id)).get();
        if (!row) throw new LabloomError({ kind: "feed-item-missing" });
        return row;
    }

    private source(id: string, includeDeleted = false): SourceRow {
        if (typeof id !== "string") throw new LabloomError({ kind: "feed-invalid-source" });
        const row = this.sources(includeDeleted).find(source => source.id === id);
        if (!row) throw new LabloomError({ kind: "feed-source-missing" });
        return row;
    }

    private duplicate(url: string, except?: string): SourceRow | undefined {
        const other = this.sources(true).find(source => source.url === url && source.id !== except);
        if (other && (other.deleted || other.status !== "cancelled" || except)) throw new LabloomError({ kind: "feed-duplicate" });
        return other;
    }

    private async refreshAll(ids: string[]): Promise<void> {
        const requests = ids.map(id => {
            // Concurrent refreshes of one source share a single request.
            let request = this.pending.get(id);
            if (!request) {
                const url = this.source(id).url;
                request = this.inTurn(() => this.refreshSource(id, url)).finally(() => {
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
        if (this.state.active < concurrency) this.state.active++;
        else await new Promise<void>(resolve => this.state.waiting.push(resolve));
        try {
            await run();
        }
        finally {
            // A waiting request takes this one's place directly.
            const next = this.state.waiting.shift();
            if (next) next();
            else this.state.active--;
        }
    }

    private async refreshSource(id: string, queuedURL: string): Promise<void> {
        if (!this.database.$client.open) return;
        let requested: SourceRow;
        try {
 requested = this.source(id);
}
        catch {
 return;
}
        // Paused or cancelled while it waited its turn.
        if (requested.status !== "enabled" || requested.url !== queuedURL) return;
        // A source changed while its request was in flight no longer wants this result.
        const current = (): SourceRow | undefined => {
            if (!this.database.$client.open) return undefined;
            const row = this.sources().find(source => source.id === id);
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
            const failure = toFailureInfo(error);
            if (failure.diagnostic) console.error("Feed refresh failed", error);
            this.knowledge.attributes.cache(id, { feed_error: JSON.stringify(failure), feed_last_added: 0, feed_last_checked: Math.floor(now / 1000), feed_failures: failures });
            this.next(source, Math.ceil((now + Math.max(wait, requestedWait)) / 1000));
        }
    }

    private next(source: SourceRow, dueAt: number): void {
        if (!source.autoRefresh || source.status !== "enabled" || source.deleted) return;
        this.knowledge.statement(`INSERT INTO timers(page_id,attr_id,lead_seconds,due_at) VALUES (?,'feed_refresh',0,?)
            ON CONFLICT(page_id,attr_id,lead_seconds) DO UPDATE SET due_at=excluded.due_at,fired_at=NULL,seen=0`).run(source.id, dueAt);
    }

    private store(source: SourceRow, result: FeedResult): void {
        const added = result.entries ? this.merge(source, result.entries) : 0;
        const now = Math.floor(this.now() / 1000);
        this.knowledge.attributes.cache(source.id, { feed_last_refreshed: now, feed_last_checked: now, feed_last_added: added, feed_error: "", feed_failures: 0, feed_etag: result.etag ?? "", feed_last_modified: result.lastModified ?? "" });
        this.next(source, now + source.intervalMinutes * 60);
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