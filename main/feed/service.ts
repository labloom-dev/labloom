import { and, eq, sql, type SQL } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { payload } from "../../shared/content/blocks";
import { recurrenceMinutes } from "../../shared/content/timers";
import { LabloomError, toFailureInfo, type FailureInfo } from "../../shared/failure";
import { type AttributeValue } from "../../shared/types/attributes";
import {
    feedIntervals, feedBatchSize,
    type FeedDownload, type FeedImport, type FeedEntry, type FeedItem, type FeedItemDetail, type FeedPaperState, type FeedQuery, type FeedSource, type FeedSourceAction, type FeedSourceInput, type FeedState
} from "../../shared/types/feed";
import { feedURL, normalizeURL } from "../../shared/utils/feed";
import * as commit from "../knowledge/commit";
import * as edits from "../knowledge/edits";
import * as events from "../knowledge/events";
import * as attachments from "../attachments/service";
import * as papers from "../knowledge/papers";
import * as knowledge from "../knowledge/records";
import { feedItems } from "../storage/tables";
import * as workspace from "../workspace-state";
import * as workspaceSettings from "../workspace-settings";
import { type WorkspaceState } from "../workspace-state";
import { FeedError, type FeedRequest, type FeedResult } from "./parser";

export type FeedLoader = (request: FeedRequest) => Promise<FeedResult>;

type SourceRow = Omit<FeedSource, "unreadCount" | "refreshing"> & { failures: number; etag: string | null; lastModified: string | null; deleted: boolean };
type Shared = { resolutions: Map<string, { input: FeedSourceInput; feed: FeedResult | null }>; pending: Map<string, Promise<void>>; pdfDownloads: Map<string, Promise<FeedDownload | null>>; pdfFailures: Map<string, FailureInfo>; active: number; waiting: (() => void)[] };
let state: Shared = newState();
function newState(): Shared {
    return { resolutions: new Map(), pending: new Map(), pdfDownloads: new Map(), pdfFailures: new Map(), active: 0, waiting: [] };
}
export function release(): void {
    for (const resume of state.waiting.splice(0)) resume();
    state = newState();
}
type ItemRow = typeof feedItems.$inferSelect;

// Temporary failures are retried three times before waiting for the next interval.
const retryDelays = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
const concurrency = 4;
const abstractLimit = 4000;

/** Identifies an entry that has neither an identifier nor an address of its own. */
function entryFingerprint(entry: Pick<FeedEntry, "title" | "authors" | "publishedAt">): string {
    const date = entry.publishedAt === null ? null : new Date(entry.publishedAt).toISOString();
    return createHash("sha256").update(JSON.stringify([entry.title, entry.authors, date])).digest("hex");
}

function sources(): SourceRow[] {
    const ids = knowledge.statement("SELECT p.id FROM pages p JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted' WHERE p.kind='feed' AND d.value=0").pluck().all() as string[];
    const values = knowledge.valuesFor(ids);
    return ids.map(id => {
        const a = values.get(id)!, at = (key: string): number | null => typeof a[key] === "number" ? a[key] * 1000 : null;
        const localNext = knowledge.statement("SELECT due_at FROM timers WHERE page_id=? AND attr_id='feed_refresh' AND lead_seconds=0").pluck().get(id) as number | null | undefined;
        return {
            id, name: knowledge.title(id, ""), url: String(a.feed_url), pinned: !!a.pinned, status: ["enabled", "paused", "cancelled"].includes(String(a.feed_status)) ? a.feed_status as SourceRow["status"] : "paused",
            autoRefresh: a.feed_refresh !== null, intervalMinutes: recurrenceMinutes(a.feed_refresh) ?? feedIntervals.default,
            lastRefreshed: at("feed_last_refreshed"), lastChecked: at("feed_last_checked"), nextRefresh: localNext == null ? null : localNext * 1000,
            lastAdded: Number(a.feed_last_added ?? 0), error: savedFailure(a.feed_error), failures: Number(a.feed_failures ?? 0),
            etag: a.feed_etag ? String(a.feed_etag) : null, lastModified: a.feed_last_modified ? String(a.feed_last_modified) : null, deleted: !!a.deleted
        };
    });
}

export function getState(query: FeedQuery, around?: string): FeedState {
    workspace.requireWorkspace();
    if (!query || typeof query !== "object" || Array.isArray(query)
        || [query.sourceId, query.keyword, query.keep, around].some(value => value !== undefined && typeof value !== "string")
        || query.read !== undefined && !["all", "unread", "read"].includes(query.read) || query.order !== undefined && !["newest", "oldest"].includes(query.order)
        || query.followed !== undefined && typeof query.followed !== "boolean") throw new LabloomError({ kind: "feed-invalid-query" });
    const unread = knowledge.statement("SELECT source_id AS id,count(*) AS total FROM feed_items WHERE is_read=0 GROUP BY source_id").all() as { id: string; total: number }[];
    const counts = new Map(unread.map(({ id, total }) => [id, total]));
    const order = { enabled: 0, paused: 1, cancelled: 2 };
    const localSources: FeedSource[] = sources().sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(({ failures: _failures, etag: _etag, lastModified: _modified, deleted: _deleted, ...row }) => ({
        ...row, unreadCount: counts.get(row.id) ?? 0, refreshing: state.pending.has(row.id)
    }));
    const localKeywords = keywords();
    const included = localSources.filter(source => query.sourceId ? source.id === query.sourceId : source.status !== "cancelled").map(source => source.id);
    const ids = itemIndex(query, included, localKeywords);
    const anchor = around ? ids.indexOf(around) : -1;
    const start = Math.max(0, anchor - Math.floor(feedBatchSize / 3));
    return {
        sources: localSources, ids, items: getRows(ids.slice(start, start + feedBatchSize)), total: ids.length,
        unreadCount: localSources.reduce((sum, source) => sum + (source.status === "cancelled" ? 0 : source.unreadCount), 0), keywords: localKeywords
    };
}

function itemIndex(query: FeedQuery, included: string[], words: string[]): string[] {
    if (!included.length) return [];
    const filters: string[] = [], args: (string | number)[] = [JSON.stringify(included)];
    if (query.read && query.read !== "all") {
        filters.push("i.is_read=?");
        args.push(Number(query.read === "read"));
    }
    if (query.keyword?.trim()) {
        filters.push("instr(lower(i.title || ' ' || i.summary),lower(?))>0");
        args.push(query.keyword.trim());
    }
    if (query.followed) {
        filters.push(words.length ? "EXISTS (SELECT 1 FROM json_each(?) k WHERE instr(lower(i.title || ' ' || i.summary),lower(k.value))>0)" : "0");
        if (words.length) args.push(JSON.stringify(words));
    }
    let where = "i.source_id IN (SELECT value FROM json_each(?))";
    if (filters.length) {
        where += " AND ((" + filters.join(" AND ") + ")" + (query.keep ? " OR i.id=?" : "") + ")";
        if (query.keep) args.push(query.keep);
    }
    return knowledge.statement(`SELECT i.id FROM feed_items i WHERE ${where}
        ORDER BY i.published_at IS NULL,i.published_at ${query.order === "oldest" ? "ASC" : "DESC"},i.id`).pluck().all(...args) as string[];
}

export function getRows(ids: string[]): FeedItem[] {
    workspace.requireWorkspace();
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new LabloomError({ kind: "feed-invalid-query" });
    if (!ids.length) return [];
    // Read from the requested IDs so SQLite does primary-key lookups for the batch.
    const rows = knowledge.statement(`SELECT i.id,i.source_id AS sourceId,knowledge_text(b.type,b.content) AS sourceName,i.title,i.url,i.authors,
        i.published_at AS publishedAt,i.is_read AS isRead,i.paper_id AS paperId,
        CASE WHEN i.paper_id IS NULL THEN 'none' WHEN paper.id IS NULL THEN 'missing' WHEN deleted.value=1 THEN 'recycled' ELSE 'saved' END AS paperState
        FROM json_each(?) j CROSS JOIN feed_items i ON i.id=j.value CROSS JOIN pages p ON p.id=i.source_id CROSS JOIN blocks b ON b.id=p.title_block_id
        CROSS JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted' AND d.value=0
        LEFT JOIN pages paper ON paper.id=i.paper_id AND paper.kind='paper'
        LEFT JOIN page_attrs deleted ON deleted.page_id=paper.id AND deleted.attr_id='deleted' ORDER BY j.key`).all(JSON.stringify(ids)) as FeedItem[];
    return rows.map(row => ({ ...row, isRead: !!row.isRead }));
}

export function getItem(id: string): FeedItemDetail {
    workspace.requireWorkspace();
    const row = item(id), localSource = source(row.sourceId);
    return {
        id: row.id, sourceId: row.sourceId, sourceName: localSource.name, title: row.title, url: row.url, authors: row.authors, summary: row.summary,
        publishedAt: row.publishedAt, isRead: row.isRead, paperId: row.paperId, content: row.content, fullContent: row.fullContent, readingPosition: row.readingPosition,
        paperState: paperState(row.paperId), pdfURL: row.pdfURL,
        pdfStatus: state.pdfDownloads.has(id) ? "downloading" : row.paperId && papers.hasPDF(row.paperId) ? "saved" : state.pdfFailures.has(id) ? "failed" : "idle", pdfFailure: state.pdfFailures.get(id) ?? null
    };
}

function updateSource(id: string, name: string, values: Record<string, AttributeValue>): void {
    return commit.run({ feed: true, history: false, updateModified: false }, () => {
        const page = knowledge.get(id), title = page.blocks[page.titleBlockId];
        edits.commitEdit({ pageId: id, batch: 0, blocks: name === page.title ? [] : [{ ...title, payload: payload("title", name) }], attributes: values }, false);
        commit.invalidate(["page:" + id, "block:" + page.titleBlockId]);

    });
}

function sourceForInput(input: FeedSourceInput): SourceRow | undefined {
    if (!input || typeof input.name !== "string" || typeof input.url !== "string" || input.id !== undefined && typeof input.id !== "string" || input.autoRefresh !== undefined && typeof input.autoRefresh !== "boolean") throw new LabloomError({ kind: "feed-invalid-source" });
    const interval = input.intervalMinutes;
    if (interval !== undefined && (!Number.isSafeInteger(interval) || interval < feedIntervals.min || interval > feedIntervals.max)) throw new LabloomError({ kind: "feed-invalid-interval" });
    const url = feedURL(input.url);
    if (!input.id) return duplicate(url);
    knowledge.writable(input.id);
    const existing = source(input.id);
    if (existing.status === "cancelled") throw new LabloomError({ kind: "feed-cancelled" });
    duplicate(url, existing.id);
    return existing;
}

export async function resolveSource(input: FeedSourceInput): Promise<string | null> {
    const session = workspace.requireWorkspace(), existing = sourceForInput(input);
    const url = feedURL(input.url);
    let feed: FeedResult | null = null;
    if (!input.id || existing?.url !== url) {
        feed = await session.loadFeed({ url, discover: true, signal: session.controller.signal }).catch(error => {
            if (workspace.isCurrent(session)) throw error;
            return null;
        });
        if (!workspace.isCurrent(session) || !feed) return null;
        if (!feed.entries) throw new LabloomError({ kind: "feed-empty" });
    }
    // Keep the parsed entries in this session. The renderer uses the one-shot key for the local save.
    const key = randomUUID();
    state.resolutions.set(key, { input, feed });
    return key;
}

export function discardSource(key: string): void {
    state.resolutions.delete(key);
}

export function saveSource(key: string): string {
    workspace.requireWorkspace();
    const resolution = state.resolutions.get(key);
    if (!resolution) return "";
    state.resolutions.delete(key);
    const { input, feed } = resolution, existing = sourceForInput(input);
    const address = feedURL(feed?.url ?? input.url);
    const other = duplicate(address, existing?.id);
    if (other && other.id !== existing?.id) throw new LabloomError({ kind: "feed-duplicate" });
    const name = input.name.trim() || existing?.name || feed?.title || new URL(address).hostname;
    const refresh = input.autoRefresh ?? existing?.autoRefresh ?? true;
    const values = { feed_url: address, feed_refresh: refresh ? { every: input.intervalMinutes ?? existing?.intervalMinutes ?? feedIntervals.default, unit: "minute" } : null };
    return commit.run({ feed: true, history: false, updateModified: false }, () => {
        let id: string;
        if (existing) {
            updateSource(existing.id, name, { ...values, ...(input.id ? {} : { feed_status: "enabled" }) });
            id = existing.id;
        }
        else id = edits.createPage("feed", name, values).id;
        if (feed) store(source(id), feed);
        return id;
    });
}

export function setSourceStatus(id: string, action: FeedSourceAction): void {
    workspace.requireWorkspace();
    return commit.run({ feed: true, history: false, updateModified: false }, () => {
        knowledge.writable(id);
        const localSource = source(id);
        if (!["pause", "cancel", "resume"].includes(action)) throw new LabloomError({ kind: "feed-invalid-action" });
        const status = action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "enabled";
        if (localSource.status !== status) updateSource(id, localSource.name, { feed_status: status });
        if (action === "cancel") edits.cacheAttributes(id, { feed_error: "" });

    });
}

export async function refresh(sourceId?: string): Promise<void> {
    workspace.requireWorkspace();
    if (sourceId !== undefined) {
        const localSource = source(sourceId);
        if (localSource.status !== "enabled") throw new LabloomError({ kind: localSource.status === "paused" ? "feed-paused" : "feed-cancelled-refresh" });
        return refreshAll([localSource.id]);
    }
    return refreshAll(sources().filter(source => source.status === "enabled").map(row => row.id));
}

export function setRead(id: string, isRead: boolean): void {
    workspace.requireWorkspace();
    return commit.run({ feed: true, history: false, updateModified: false }, () => {
        if (typeof id !== "string" || typeof isRead !== "boolean") throw new LabloomError({ kind: "feed-invalid-read-state" });
        if (!workspace.database().update(feedItems).set({ isRead }).where(eq(feedItems.id, id)).run().changes) {
            throw new LabloomError({ kind: "feed-item-missing" });
        }

    });
}

export function markAllRead(sourceId?: string): number {
    workspace.requireWorkspace();
    return commit.run({ feed: true, history: false, updateModified: false }, () => {
        if (sourceId !== undefined) source(sourceId);
        const scope = sourceId !== undefined ? eq(feedItems.sourceId, sourceId)
            : sql`${feedItems.sourceId} IN (SELECT p.id FROM pages p JOIN page_attrs s ON s.page_id=p.id AND s.attr_id='feed_status' JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted' WHERE p.kind='feed' AND s.value IS NOT 'cancelled' AND d.value=0)`;
        const { changes } = workspace.database().update(feedItems).set({ isRead: true }).where(and(scope, eq(feedItems.isRead, false))).run();
        return changes;

    });
}

export function setPosition(id: string, progress: number): void {
    workspace.requireWorkspace();
    return commit.run({ feed: true, history: false, updateModified: false }, () => {
        if (typeof id !== "string" || typeof progress !== "number" || !(progress >= 0 && progress <= 1)) throw new LabloomError({ kind: "feed-invalid-position" });
        workspace.database().update(feedItems).set({ readingPosition: { progress } }).where(eq(feedItems.id, id)).run();

    });
}

export function setKeywords(keywords: string[]): string[] {
    return workspaceSettings.update({ feedKeywords: keywords }).feedKeywords;
}

export function importItem(id: string, replace = false): FeedImport {
    workspace.requireWorkspace();
    const localItem = item(id);
    const state = paperState(localItem.paperId);
    if (state === "saved") return { pageId: localItem.paperId!, downloadPDF: false };
    // A recycled or missing page is never replaced by guessing; the reader confirms first.
    if (state !== "none" && !replace) throw new LabloomError({ kind: "feed-reimport-confirmation" });
    const localSource = source(localItem.sourceId);
    const pageId = commit.run({ feed: true, history: false, updateModified: false }, () => {
        const page = papers.createReference({
            title: localItem.title,
            authors: localItem.authors,
            url: localItem.url,
            abstract: localItem.summary.length > abstractLimit ? `${localItem.summary.slice(0, abstractLimit)}…` : localItem.summary,
            published: localItem.publishedAt === null ? null : new Date(localItem.publishedAt).toISOString().slice(0, 10),
            origin: {
                kind: "feed",
                itemId: localItem.id,
                sourceId: localItem.sourceId,
                sourceName: localSource?.name ?? null,
                feedURL: localSource?.url ?? null,
                externalId: localItem.externalId,
                url: localItem.url
            }
        });
        workspace.database().update(feedItems).set({ paperId: page }).where(eq(feedItems.id, localItem.id)).run();
        return page;
    });
    return { pageId, downloadPDF: !!localItem.pdfURL };
}

export function itemURL(id: string): string {
    workspace.requireWorkspace();
    const { url } = item(id);
    if (!url) throw new LabloomError({ kind: "feed-no-url" });
    return feedURL(url);
}

function keywords(): string[] {
    return workspaceSettings.get().feedKeywords;
}

function savedFailure(value: AttributeValue): FailureInfo | null {
    if (!value) return null;
    try {
        return toFailureInfo(JSON.parse(String(value)));
    }
    catch {
        return { kind: "unexpected", diagnostic: String(value) };
    }
}

function paperState(paperId: string | null): FeedPaperState {
    if (!paperId) return "none";
    return papers.state(paperId);
}

function item(id: string): ItemRow {
    if (typeof id !== "string") throw new LabloomError({ kind: "feed-invalid-item" });
    const row = workspace.database().select().from(feedItems).where(eq(feedItems.id, id)).get();
    if (!row) throw new LabloomError({ kind: "feed-item-missing" });
    return row;
}

function source(id: string): SourceRow {
    if (typeof id !== "string") throw new LabloomError({ kind: "feed-invalid-source" });
    const row = sources().find(source => source.id === id);
    if (!row) throw new LabloomError({ kind: "feed-source-missing" });
    return row;
}

function duplicate(url: string, except?: string): SourceRow | undefined {
    const other = sources().find(source => source.url === url && source.id !== except);
    if (other && (other.status !== "cancelled" || except)) throw new LabloomError({ kind: "feed-duplicate" });
    return other;
}

async function refreshSource(id: string, queuedURL: string, session: WorkspaceState): Promise<void> {
    if (!workspace.isCurrent(session)) return;
    let requested: SourceRow;
    try {
        requested = source(id);
    }
    catch {
        return;
    }
    // Paused or cancelled while it waited its turn.
    if (requested.status !== "enabled" || requested.url !== queuedURL) return;
    // A source changed while its request was in flight no longer wants this result.
    const current = (): SourceRow | undefined => {
        if (!workspace.isCurrent(session)) return undefined;
        const row = sources().find(source => source.id === id);
        return row && row.status === "enabled" && row.url === requested.url ? row : undefined;
    };
    try {
        const result = await session.loadFeed({ url: requested.url, etag: requested.etag, lastModified: requested.lastModified, signal: session.controller.signal });
        if (!workspace.isCurrent(session)) return;
        commit.run({ feed: true, history: false, updateModified: false }, () => {
            const localSource = current();
            if (localSource) store(localSource, result);
        });
    }
    catch (error) {
        const localSource = current();
        if (!localSource) return;
        // Network failures all read alike to the user; the log keeps what went wrong. Addresses may carry private tokens, so only the host is recorded.
        if (error instanceof Error && error.cause !== undefined) console.warn(`Feed request to ${new URL(localSource.url).host} failed:`, error.cause);
        const failures = localSource.failures + 1;
        // Only failures the fetch layer marked as temporary are retried early; a format error will not fix itself.
        const retryable = error instanceof FeedError && error.retryable;
        const wait = retryable && failures <= retryDelays.length ? retryDelays[failures - 1] : localSource.intervalMinutes * 60000;
        const requestedWait = error instanceof FeedError ? error.retryAfter ?? 0 : 0;
        const now = workspace.clock();
        const failure = toFailureInfo(error);
        if (failure.diagnostic) console.error("Feed refresh failed", error);
        commit.run({ feed: true, history: false, updateModified: false }, () => {
            edits.cacheAttributes(id, { feed_error: JSON.stringify(failure), feed_last_added: 0, feed_last_checked: Math.floor(now / 1000), feed_failures: failures });
            next(localSource, Math.ceil((now + Math.max(wait, requestedWait)) / 1000));
        });
    }
}

function next(source: SourceRow, dueAt: number): void {
    return commit.run({ feed: true, history: false, updateModified: false }, () => {
        if (!source.autoRefresh || source.status !== "enabled" || source.deleted) return;
        knowledge.statement(`INSERT INTO timers(page_id,attr_id,lead_seconds,due_at) VALUES (?,'feed_refresh',0,?)
        ON CONFLICT(page_id,attr_id,lead_seconds) DO UPDATE SET due_at=excluded.due_at,fired_at=NULL,seen=0`).run(source.id, dueAt);

    });
}

function store(source: SourceRow, result: FeedResult): void {
    return commit.run({ feed: true, history: false, updateModified: false }, () => {
        const added = result.entries ? merge(source, result.entries) : 0;
        const now = Math.floor(workspace.clock() / 1000);
        edits.cacheAttributes(source.id, { feed_last_refreshed: now, feed_last_checked: now, feed_last_added: added, feed_error: "", feed_failures: 0, feed_etag: result.etag ?? "", feed_last_modified: result.lastModified ?? "" });
        next(source, now + source.intervalMinutes * 60);

    });
}

function merge(source: SourceRow, entries: FeedEntry[]): number {
    const inSource = eq(feedItems.sourceId, source.id);
    const find = (condition: SQL): ItemRow[] => workspace.database().select().from(feedItems).where(and(inSource, condition)).all();
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
            workspace.database().insert(feedItems).values({
                ...entry,
                id: randomUUID(),
                sourceId: source.id,
                normalizedUrl,
                fingerprint
            }).run();
            added++;
            continue;
        }
        // Fill in what the saved item lacks and follow the source's corrections; personal state is untouched.
        workspace.database().update(feedItems).set({
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
/** One download attempt per item in the current session. */
export function fetchPDF(id: string): Promise<FeedDownload | null> {
    const session = workspace.requireWorkspace(), active = state;
    const pending = active.pdfDownloads.get(id);
    if (pending) return pending;
    const row = item(id);
    if (!row.paperId || paperState(row.paperId) !== "saved") throw new LabloomError({ kind: "feed-paper-required" });
    if (!row.pdfURL) throw new LabloomError({ kind: "feed-no-pdf" });
    if (papers.hasPDF(row.paperId)) return Promise.resolve(null);
    const pageId = row.paperId, url = feedURL(row.pdfURL);
    active.pdfFailures.delete(id);
    const attempt = attachments.download(url, { expectedType: "application/pdf" }).then(fileId => {
        if (!fileId || !workspace.isCurrent(session) || item(id).paperId !== pageId || paperState(pageId) !== "saved") return null;
        return { pageId, fileId };
    }).catch(error => {
        if (workspace.isCurrent(session)) {
            console.error("Feed PDF import failed", error);
            active.pdfFailures.set(id, toFailureInfo(error));
        }
        return null;
    }).finally(() => {
        active.pdfDownloads.delete(id);
        if (workspace.isCurrent(session)) events.feedChanged();
    });
    active.pdfDownloads.set(id, attempt);
    events.feedChanged();
    return attempt;
}
async function refreshAll(ids: string[]): Promise<void> {
    const session = workspace.requireWorkspace(), active = state;
    const requests = ids.map(id => {
        let request = active.pending.get(id);
        if (!request) {
            const url = source(id).url;
            request = inTurn(() => refreshSource(id, url, session), session, active).finally(() => {
                active.pending.delete(id);
                if (workspace.isCurrent(session)) events.feedChanged();
            });
            active.pending.set(id, request);
        }
        return request;
    });
    if (requests.length) events.feedChanged();
    await Promise.all(requests);
}
async function inTurn(run: () => Promise<void>, session: WorkspaceState, active: Shared): Promise<void> {
    if (active.active < concurrency) active.active++;
    else await new Promise<void>(resolve => active.waiting.push(resolve));
    try {
        if (workspace.isCurrent(session)) await run();
    }
    finally {
        const localNext = active.waiting.shift();
        if (localNext) localNext();
        else active.active--;
    }
}