import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FeedEntry, FeedItem, FeedQuery, FeedSource, FeedSourceInput, FeedState } from "../../shared/types/feed";
import { feedURL } from "../../shared/utils/feed";
import { fetchFeed } from "./parser";

export class FeedService {
    private pending = new Map<string, Promise<void>>();

    constructor(private readonly database: Database.Database, private readonly load = fetchFeed) {
        database.exec(`
            CREATE TABLE IF NOT EXISTS feed_sources (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                last_refreshed TEXT,
                last_added INTEGER NOT NULL DEFAULT 0,
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS feed_items (
                id TEXT PRIMARY KEY NOT NULL,
                source_id TEXT NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
                external_id TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT,
                authors TEXT NOT NULL,
                summary TEXT NOT NULL,
                published_at TEXT,
                is_read INTEGER NOT NULL DEFAULT 0,
                UNIQUE (source_id, external_id)
            );
            CREATE TABLE IF NOT EXISTS feed_options (
                source_id TEXT PRIMARY KEY NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
                group_name TEXT NOT NULL DEFAULT '',
                paused INTEGER NOT NULL DEFAULT 0,
                interval_minutes INTEGER NOT NULL DEFAULT 60,
                keywords TEXT NOT NULL DEFAULT '[]',
                last_attempt TEXT
            );
            INSERT OR IGNORE INTO feed_options (source_id) SELECT id FROM feed_sources;
            CREATE INDEX IF NOT EXISTS feed_items_date ON feed_items(published_at DESC);
        `);
    }

    getState(query: FeedQuery): FeedState {
        if (!query || typeof query !== "object"
            || (query.sourceId !== undefined && typeof query.sourceId !== "string")
            || (query.keyword !== undefined && typeof query.keyword !== "string")
            || (query.unreadOnly !== undefined && typeof query.unreadOnly !== "boolean")
            || (query.group !== undefined && (typeof query.group !== "string" || query.group.length > 100))
            || (query.sort !== undefined && !["newest", "oldest", "unread"].includes(query.sort))
            || (query.preferredOnly !== undefined && typeof query.preferredOnly !== "boolean")
            || (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))) {
            throw new Error("无效的订阅查询。");
        }
        const sources = this.database.prepare<[], FeedSource>(`
            SELECT s.id, s.name, s.url, o.group_name AS "group", o.paused, o.interval_minutes AS interval, o.keywords, s.last_refreshed AS lastRefreshed, s.last_added AS lastAdded, s.error,
                (SELECT COUNT(*) FROM feed_items WHERE source_id = s.id AND is_read = 0) AS unreadCount
            FROM feed_sources s JOIN feed_options o ON o.source_id = s.id ORDER BY o.group_name, s.name, s.id
        `).all();
        for (const source of sources) source.paused = Boolean(source.paused);
        const where = `WHERE (@sourceId = '' OR i.source_id = @sourceId)
            AND (@unreadOnly = 0 OR i.is_read = 0)
            AND (@keyword = '' OR instr(lower(i.title || ' ' || i.summary), lower(@keyword)) > 0)
            AND (@groupName = '' OR EXISTS (SELECT 1 FROM feed_options o WHERE o.source_id = i.source_id AND o.group_name = @groupName))
            AND (@preferredOnly = 0 OR EXISTS (SELECT 1 FROM feed_options o, json_each(o.keywords) k WHERE o.source_id = i.source_id AND instr(lower(i.title || ' ' || i.summary), lower(k.value)) > 0))`;
        const params = {
            sourceId: query.sourceId ?? "",
            keyword: query.keyword?.trim() ?? "",
            unreadOnly: query.unreadOnly ? 1 : 0,
            offset: query.offset ?? 0, groupName: query.group ?? "", preferredOnly: query.preferredOnly ? 1 : 0
        };
        const rows = this.database.prepare<typeof params, Omit<FeedItem, "isRead"> & { isRead: number; }>(`
            SELECT i.id, i.source_id AS sourceId, s.name AS sourceName, i.external_id AS externalId,
                i.title, i.url, i.authors, i.summary, i.published_at AS publishedAt, i.is_read AS isRead
            FROM feed_items i JOIN feed_sources s ON s.id = i.source_id ${where}
            ORDER BY ${query.sort === "oldest" ? "i.published_at ASC" : query.sort === "unread" ? "i.is_read ASC, i.published_at DESC" : "i.published_at DESC"}, i.id LIMIT 50 OFFSET @offset
        `).all(params);
        const total = this.database.prepare<typeof params, { count: number; }>(`
            SELECT COUNT(*) AS count FROM feed_items i ${where}
        `).get(params)!.count;
        for (const source of sources) source.keywords = JSON.parse(source.keywords || "[]").join("，");
        return { sources, items: rows.map(row => ({ ...row, isRead: Boolean(row.isRead) })), total };
    }

    async saveSource(input: FeedSourceInput): Promise<string> {
        if (!input || typeof input.name !== "string" || typeof input.url !== "string"
            || (input.id !== undefined && typeof input.id !== "string")) throw new Error("无效的订阅来源。");
        const group = input.group ?? "", paused = input.paused ?? false, interval = input.interval ?? 60, keywords = input.keywords ?? "";
        if (typeof group !== "string" || group.length > 100 || typeof paused !== "boolean" || !Number.isInteger(interval) || (interval !== 0 && (interval < 5 || interval > 1440)) || typeof keywords !== "string" || keywords.length > 2000) throw new Error("无效的分组、刷新间隔或关键词。");
        const preferences = [...new Set(keywords.split(/[,，;；\n]/).map(value => value.trim()).filter(Boolean))];
        if (preferences.length > 30) throw new Error("最多设置 30 个偏好关键词。");
        const name = input.name.trim();
        if (!name || name.length > 200 || input.url.length > 4096) throw new Error("请填写名称（最多 200 字符）和订阅地址（最多 4096 字符）。");
        const url = feedURL(input.url);
        const id = input.id ?? randomUUID();
        const existing = input.id ? this.source(id) : undefined;
        if (this.pending.has(id)) throw new Error("此来源正在刷新，请完成后再修改。");
        const duplicate = this.database.prepare("SELECT id FROM feed_sources WHERE url = ? AND id != ?").get(url, id);
        if (duplicate) throw new Error("这个订阅地址已经添加。");
        const request = (async () => {
            // Validate a new address before changing any saved configuration.
            const entries = !existing || existing.url !== url ? await this.load(url) : undefined;
            this.database.transaction(() => {
                if (existing) {
                    this.source(id);
                    this.database.prepare("UPDATE feed_sources SET name = ?, url = ? WHERE id = ?").run(name, url, id);
                }
                else this.database.prepare("INSERT INTO feed_sources (id, name, url) VALUES (?, ?, ?)").run(id, name, url);
                this.database.prepare("INSERT INTO feed_options (source_id, group_name, paused, interval_minutes, keywords) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET group_name = excluded.group_name, paused = excluded.paused, interval_minutes = excluded.interval_minutes, keywords = excluded.keywords").run(id, group.trim(), paused ? 1 : 0, interval, JSON.stringify(preferences));
                if (entries) this.storeEntries(id, entries);
            })();
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
        this.database.prepare("DELETE FROM feed_sources WHERE id = ?").run(id);
    }

    async refresh(sourceId?: string): Promise<void> {
        const sources = sourceId === undefined ? this.getState({}).sources.filter(source => !source.paused) : [this.source(sourceId)];
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

    async idle(): Promise<void> { while (this.pending.size) await Promise.allSettled([...this.pending.values()]); }

    async refreshDue(now = Date.now()): Promise<void> {
        const sources = this.database.prepare<[], { id: string; last_attempt: string | null; interval_minutes: number }>("SELECT source_id AS id, last_attempt, interval_minutes FROM feed_options WHERE paused = 0 AND interval_minutes > 0").all();
        for (const source of sources) {
            if (!this.database.open) return;
            if (!source.last_attempt || now - Date.parse(source.last_attempt) >= source.interval_minutes * 60000) await this.refresh(source.id);
        }
    }

    setReadAll(query: FeedQuery): void {
        // Gather the full selection before changing unread filters or sorting.
        const ids: string[] = []; let offset = 0;
        while (true) { const batch = this.getState({ ...query, offset }); ids.push(...batch.items.map(item => item.id)); offset += batch.items.length; if (offset >= batch.total || !batch.items.length) break; }
        const statement = this.database.prepare("UPDATE feed_items SET is_read = 1 WHERE id = ?");
        this.database.transaction(() => { for (const id of ids) statement.run(id); })();
    }

    setRead(id: string, isRead: boolean): void {
        if (typeof id !== "string" || typeof isRead !== "boolean") throw new Error("无效的阅读状态。");
        if (!this.database.prepare("UPDATE feed_items SET is_read = ? WHERE id = ?").run(isRead ? 1 : 0, id).changes) {
            throw new Error("条目不存在。");
        }
    }

    itemURL(id: string): string {
        if (typeof id !== "string") throw new Error("无效的条目。");
        const row = this.database.prepare<[string], { url: string | null; }>("SELECT url FROM feed_items WHERE id = ?").get(id);
        if (!row?.url) throw new Error("此条目没有可用的原文链接。");
        return feedURL(row.url);
    }

    private source(id: string): Pick<FeedSource, "id" | "url"> {
        if (typeof id !== "string") throw new Error("无效的订阅来源。");
        const source = this.database.prepare<[string], Pick<FeedSource, "id" | "url">>("SELECT id, url FROM feed_sources WHERE id = ?").get(id);
        if (!source) throw new Error("订阅来源不存在。");
        return source;
    }

    private async refreshSource(source: Pick<FeedSource, "id" | "url">): Promise<void> {
        this.database.prepare("UPDATE feed_options SET last_attempt = ? WHERE source_id = ?").run(new Date().toISOString(), source.id);
        try {
            const entries = await this.load(source.url);
            this.database.transaction(() => this.storeEntries(source.id, entries))();
        }
        catch (error) {
            if (!this.database.open) return;
            const message = error instanceof Error ? error.message : "抓取失败，请重试。";
            this.database.prepare("UPDATE feed_sources SET error = ?, last_added = 0 WHERE id = ?").run(message, source.id);
        }
    }

    private storeEntries(sourceId: string, entries: FeedEntry[]): void {
        const insert = this.database.prepare(`
            INSERT INTO feed_items (id, source_id, external_id, title, url, authors, summary, published_at)
            VALUES (@id, @sourceId, @externalId, @title, @url, @authors, @summary, @publishedAt)
            ON CONFLICT(source_id, external_id) DO NOTHING
        `);
        let added = 0;
        for (const entry of entries) added += insert.run({ ...entry, id: randomUUID(), sourceId }).changes;
        this.database.prepare("UPDATE feed_options SET last_attempt = ? WHERE source_id = ?").run(new Date().toISOString(), sourceId);
        this.database.prepare("UPDATE feed_sources SET last_refreshed = ?, last_added = ?, error = NULL WHERE id = ?")
            .run(new Date().toISOString(), added, sourceId);
    }
}