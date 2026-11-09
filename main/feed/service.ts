import { randomUUID } from "node:crypto";
import { and, count, desc, eq, getTableColumns, ne, placeholder, sql } from "drizzle-orm";
import { type FeedEntry, type FeedQuery, type FeedSource, type FeedSourceInput, type FeedState } from "../../shared/types/feed";
import { feedURL } from "../../shared/utils/feed";
import { type WorkspaceDatabase } from "../storage/database";
import { feedItems, feedSources } from "../storage/tables";
import { fetchFeed } from "./parser";

export class FeedService {
    private pending = new Map<string, Promise<void>>();

    constructor(private readonly database: WorkspaceDatabase, private readonly load = fetchFeed) {}

    getState(query: FeedQuery): FeedState {
        if (!query || typeof query !== "object"
            || (query.sourceId !== undefined && typeof query.sourceId !== "string")
            || (query.keyword !== undefined && typeof query.keyword !== "string")
            || (query.unreadOnly !== undefined && typeof query.unreadOnly !== "boolean")
            || (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))) {
            throw new Error("无效的订阅查询。");
        }
        const sources = this.database.select({
            ...getTableColumns(feedSources),
            unreadCount: this.database.$count(feedItems, and(eq(feedItems.sourceId, feedSources.id), eq(feedItems.isRead, false)))
        }).from(feedSources).orderBy(feedSources.name, feedSources.id).all();
        const keyword = query.keyword?.trim();
        const where = and(
            query.sourceId ? eq(feedItems.sourceId, query.sourceId) : undefined,
            query.unreadOnly ? eq(feedItems.isRead, false) : undefined,
            keyword ? sql`instr(lower(${feedItems.title} || ' ' || ${feedItems.summary}), lower(${keyword})) > 0` : undefined
        );
        const items = this.database.select({
            ...getTableColumns(feedItems),
            sourceName: feedSources.name
        }).from(feedItems).innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
            .where(where).orderBy(desc(feedItems.publishedAt), feedItems.id).limit(50).offset(query.offset ?? 0).all();
        const total = this.database.select({ count: count() }).from(feedItems).where(where).get()!.count;
        return { sources, items, total };
    }

    async saveSource(input: FeedSourceInput): Promise<string> {
        if (!input || typeof input.name !== "string" || typeof input.url !== "string"
            || (input.id !== undefined && typeof input.id !== "string")) throw new Error("无效的订阅来源。");
        const name = input.name.trim();
        if (!name || name.length > 200 || input.url.length > 4096) throw new Error("请填写名称（最多 200 字符）和订阅地址（最多 4096 字符）。");
        const url = feedURL(input.url);
        const id = input.id ?? randomUUID();
        const existing = input.id ? this.source(id) : undefined;
        if (this.pending.has(id)) throw new Error("此来源正在刷新，请完成后再修改。");
        const duplicate = this.database.select({ id: feedSources.id }).from(feedSources)
            .where(and(eq(feedSources.url, url), ne(feedSources.id, id))).get();
        if (duplicate) throw new Error("这个订阅地址已经添加。");
        const request = (async () => {
            // Validate a new address before changing any saved configuration.
            const entries = !existing || existing.url !== url ? await this.load(url) : undefined;
            this.database.transaction(() => {
                if (existing) {
                    this.source(id);
                    this.database.update(feedSources).set({ name, url }).where(eq(feedSources.id, id)).run();
                }
                else this.database.insert(feedSources).values({ id, name, url }).run();
                if (entries) this.storeEntries(id, entries);
            });
        })();
        this.pending.set(id, request);
        try {
            await request;
        }
        finally {
            this.pending.delete(id);
        }
        return id;
    }

    removeSource(id: string): void {
        this.source(id);
        if (this.pending.has(id)) throw new Error("此来源正在刷新，请完成后再取消订阅。");
        this.database.delete(feedSources).where(eq(feedSources.id, id)).run();
    }

    async refresh(sourceId?: string): Promise<void> {
        const sources = sourceId === undefined ? this.getState({}).sources : [this.source(sourceId)];
        for (const source of sources) {
            const previous = this.pending.get(source.id);
            if (previous) {
                await previous;
                continue;
            }
            const request = this.refreshSource(source);
            this.pending.set(source.id, request);
            try {
                await request;
            }
            finally {
                this.pending.delete(source.id);
            }
        }
    }

    setRead(id: string, isRead: boolean): void {
        if (typeof id !== "string" || typeof isRead !== "boolean") throw new Error("无效的阅读状态。");
        if (!this.database.update(feedItems).set({ isRead }).where(eq(feedItems.id, id)).run().changes) {
            throw new Error("条目不存在。");
        }
    }

    itemURL(id: string): string {
        if (typeof id !== "string") throw new Error("无效的条目。");
        const row = this.database.select({ url: feedItems.url }).from(feedItems).where(eq(feedItems.id, id)).get();
        if (!row?.url) throw new Error("此条目没有可用的原文链接。");
        return feedURL(row.url);
    }

    private source(id: string): Pick<FeedSource, "id" | "url"> {
        if (typeof id !== "string") throw new Error("无效的订阅来源。");
        const source = this.database.select({ id: feedSources.id, url: feedSources.url }).from(feedSources).where(eq(feedSources.id, id)).get();
        if (!source) throw new Error("订阅来源不存在。");
        return source;
    }

    private async refreshSource(source: Pick<FeedSource, "id" | "url">): Promise<void> {
        try {
            const entries = await this.load(source.url);
            this.database.transaction(() => this.storeEntries(source.id, entries));
        }
        catch (error) {
            if (!this.database.$client.open) return;
            const message = error instanceof Error ? error.message : "抓取失败，请重试。";
            this.database.update(feedSources).set({ error: message, lastAdded: 0 }).where(eq(feedSources.id, source.id)).run();
        }
    }

    private storeEntries(sourceId: string, entries: FeedEntry[]): void {
        const insert = this.database.insert(feedItems).values({
            id: placeholder("id"),
            sourceId: placeholder("sourceId"),
            externalId: placeholder("externalId"),
            title: placeholder("title"),
            url: placeholder("url"),
            authors: placeholder("authors"),
            summary: placeholder("summary"),
            publishedAt: placeholder("publishedAt")
        }).onConflictDoNothing({ target: [feedItems.sourceId, feedItems.externalId] }).prepare();
        let added = 0;
        for (const entry of entries) added += insert.run({ ...entry, id: randomUUID(), sourceId }).changes;
        this.database.update(feedSources).set({ lastRefreshed: Date.now(), lastAdded: added, error: null })
            .where(eq(feedSources.id, sourceId)).run();
    }
}