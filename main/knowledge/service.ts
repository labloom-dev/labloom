import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { PageChanges, CreatePageInput, DocumentNode, LinkRecord, PageKind, PageList, PageQuery, PageRecord, PageSummary, PaperMetadata, PropertyDefinition, Reminder, SavePageInput, Schedule } from "../../shared/types/knowledge";
import { defaultSchedule, scheduleTime } from "../../shared/utils/schedule";
import { documentText, identifier, object, plainDocument, text, validateDocument, webURL } from "./document";

const kinds = ["editable", "paper", "task", "event", "annotation"] as const;
const summaryColumns = `p.id, p.kind, title.content AS title, d.created_at AS createdAt, d.updated_at AS updatedAt,
    d.revision, COALESCE(deleted.value, 0) AS deleted, d.independent, d.pinned,
    substr(d.search_text, 1, 180) AS excerpt, d.schedule,
    COALESCE((SELECT json_group_array(name) FROM page_tags WHERE page_id = p.id), '[]') AS tags`;
const summaryFrom = `FROM pages p JOIN blocks title ON title.id = p.title_block_id
    JOIN page_details d ON d.page_id = p.id LEFT JOIN page_attrs deleted ON deleted.page_id = p.id AND deleted.attr_id = 'deleted'`;
type SummaryRow = Omit<PageSummary, "deleted" | "independent" | "pinned" | "tags" | "schedule"> & {
    deleted: number; independent: number; pinned: number; tags: string; schedule: string | null;
};

function summary(row: SummaryRow): PageSummary {
    return { ...row, deleted: !!row.deleted, independent: !!row.independent, pinned: !!row.pinned, tags: JSON.parse(row.tags), schedule: row.schedule ? JSON.parse(row.schedule) : null };
}

function validatePaper(value: unknown): PaperMetadata | null {
    if (value === null || value === undefined) return null;
    const record = object(value);
    return {
        authors: text(record.authors, 10000), doi: text(record.doi, 1000), year: text(record.year, 100),
        venue: text(record.venue, 1000), url: webURL(record.url, true), abstract: text(record.abstract, 100000)
    };
}

function validateSchedule(value: unknown, kind: PageKind): Schedule | null {
    if (kind !== "task" && kind !== "event") return null;
    const record = object(value);
    if (!["todo", "doing", "done"].includes(String(record.status)) || !["low", "normal", "high"].includes(String(record.priority)) || typeof record.allDay !== "boolean") throw new Error("无效的任务状态或优先级。");
    const timezone = text(record.timezone, 100, false);
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
    catch { throw new Error("请选择有效的时区。"); }
    for (const key of ["start", "end", "reminder"] as const) {
        const value = text(record[key], 100);
        if (value && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10))) throw new Error("日期无效，请重新选择。");
    }
    if (kind === "event" && (!record.start || !record.end)) throw new Error("日程需要开始与结束时间。");
    if (record.start && record.end && scheduleTime(String(record.end), timezone, true) < scheduleTime(String(record.start), timezone)) throw new Error("结束时间不能早于开始时间。");
    return { status: record.status as Schedule["status"], priority: record.priority as Schedule["priority"], start: String(record.start), end: String(record.end), reminder: String(record.reminder), timezone, allDay: record.allDay };
}

export class KnowledgeService {
    constructor(readonly database: Database.Database) {}

    list(query: PageQuery = {}): PageList {
        object(query);
        const keyword = text(query.keyword ?? "", 1000).trim();
        if (query.kind && !kinds.includes(query.kind)) throw new Error("无效的页面类型。");
        if ((query.deleted !== undefined && typeof query.deleted !== "boolean") || (query.pinned !== undefined && typeof query.pinned !== "boolean")) throw new Error("无效的页面筛选。");
        const tags = this.validateTags(query.tags ?? []);
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 50;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("无效的分页范围。");
        const order = { updated: "d.updated_at DESC, p.id", created: "d.created_at DESC, p.id", title: "title.content COLLATE NOCASE, p.id" }[query.sort ?? "updated"];
        if (!order) throw new Error("无效的排序方式。");
        const propertyFilters = object(query.properties ?? {});
        if (Object.keys(propertyFilters).length > 20) throw new Error("最多组合 20 个属性条件。");
        for (const [id, value] of Object.entries(propertyFilters)) {
            identifier(id);
            if (!id.startsWith("custom:") || (value !== null && !["string", "number", "boolean"].includes(typeof value))) throw new Error("无效的属性筛选。");
            if (typeof value === "string") text(value, 10000);
        }
        const params = { properties: JSON.stringify(propertyFilters), keyword, kind: query.kind ?? "", deleted: query.deleted ? 1 : 0, pinned: query.pinned ? 1 : 0, tags: JSON.stringify(tags), offset, limit };
        const where = `WHERE COALESCE(deleted.value, 0) = @deleted AND (@kind = '' OR p.kind = @kind)
            AND (@pinned = 0 OR d.pinned = 1)
            AND (@keyword = '' OR instr(lower(title.content || ' ' || d.search_text || ' ' || COALESCE(d.paper, '')), lower(@keyword)) > 0)
            AND NOT EXISTS (SELECT 1 FROM json_each(@properties) wanted WHERE (SELECT value FROM page_attrs WHERE page_id = p.id AND attr_id = wanted.key) IS NOT wanted.value)
            AND NOT EXISTS (SELECT 1 FROM json_each(@tags) wanted WHERE NOT EXISTS (SELECT 1 FROM page_tags WHERE page_id = p.id AND name = wanted.value))`;
        const rows = this.database.prepare<typeof params, SummaryRow>(`SELECT ${summaryColumns} ${summaryFrom} ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`).all(params);
        const total = this.database.prepare<typeof params, { total: number }>(`SELECT COUNT(*) AS total ${summaryFrom} ${where}`).get(params)!.total;
        return { items: rows.map(summary), total };
    }

    get(id: string): PageRecord {
        identifier(id);
        const row = this.database.prepare<[string], SummaryRow>(`SELECT ${summaryColumns} ${summaryFrom} WHERE p.id = ?`).get(id);
        if (!row) throw new Error("页面不存在。");
        const raw = this.database.prepare<[string], { children: string; paper: string | null }>("SELECT p.children, d.paper FROM pages p JOIN page_details d ON d.page_id = p.id WHERE p.id = ?").get(id)!;
        const children = JSON.parse(raw.children) as string[];
        const nodes: DocumentNode[] = [];
        for (const blockId of children) {
            const block = this.database.prepare<[string], { content: string | null; type: string }>("SELECT content, type FROM blocks WHERE id = ?").get(blockId);
            if (!block) continue;
            let node: DocumentNode;
            try {
                const value = JSON.parse(block.content ?? "null");
                node = value && typeof value === "object" && typeof value.type === "string" ? value : plainDocument(block.content ?? "").content[0];
            }
            catch { node = plainDocument(block.content ?? "").content[0]; }
            node.attrs = { ...node.attrs, uid: blockId };
            nodes.push(node);
        }
        const properties: PageRecord["properties"] = {};
        for (const value of this.database.prepare<[string], { id: string; type: string; value: string | number | null }>("SELECT a.id, a.type, p.value FROM page_attrs p JOIN attrs a ON a.id = p.attr_id WHERE p.page_id = ? AND a.id LIKE 'custom:%'").all(id)) {
            properties[value.id] = value.type === "boolean" && value.value !== null ? !!value.value : value.value;
        }
        return { ...summary(row), document: { type: "doc", content: nodes.length ? nodes : [{ type: "paragraph" }] }, paper: raw.paper ? JSON.parse(raw.paper) : null, properties };
    }

    create(input: CreatePageInput = {}): PageRecord {
        object(input);
        const kind = input.kind ?? "editable";
        if (!kinds.includes(kind)) throw new Error("无效的页面类型。");
        const title = text(input.title ?? (kind === "task" ? "新任务" : kind === "event" ? "新日程" : "未命名笔记"), 500, false).trim();
        const now = new Date().toISOString();
        const id = randomUUID();
        return this.database.transaction(() => {
            const titleId = randomUUID();
            this.database.prepare("INSERT INTO blocks (id, type, content) VALUES (?, 'title', ?)").run(titleId, title);
            this.database.prepare("INSERT INTO pages (id, kind, title_block_id) VALUES (?, ?, ?)").run(id, kind, titleId);
            this.database.prepare("INSERT INTO page_details (page_id, created_at, updated_at) VALUES (?, ?, ?)").run(id, now, now);
            return this.save({
                id, revision: 0, title, document: input.document ?? { type: "doc", content: [{ type: "paragraph" }] },
                tags: [], properties: {}, pinned: false, independent: true, paper: input.paper ?? null,
                schedule: input.schedule ?? (kind === "event" ? { ...defaultSchedule(), allDay: true, start: now.slice(0, 10), end: now.slice(0, 10) } : kind === "task" ? defaultSchedule() : null)
            });
        })();
    }

    save(input: SavePageInput): PageRecord {
        object(input);
        identifier(input.id);
        if (!Number.isSafeInteger(input.revision) || input.revision < 0 || typeof input.independent !== "boolean" || typeof input.pinned !== "boolean") throw new Error("无效的页面版本或属性。");
        const title = text(input.title, 500, false).trim();
        const document = validateDocument(input.document);
        const tags = this.validateTags(input.tags);
        const paper = validatePaper(input.paper);
        const properties = object(input.properties);
        return this.database.transaction(() => {
            const current = this.get(input.id);
            if (current.deleted) throw new Error("页面已在回收站，请先恢复。");
            if (current.revision !== input.revision) throw new Error("页面已被其他编辑更新。当前输入已保留，请先比较最新版本后重试。");
            const schedule = validateSchedule(input.schedule, current.kind);
            const row = this.database.prepare<[string], { title_block_id: string; children: string }>("SELECT title_block_id, children FROM pages WHERE id = ?").get(input.id)!;
            const oldIds = new Set(JSON.parse(row.children) as string[]);
            const ids: string[] = [];
            const links: { id: string; target: string; block: string | null; mode: string; writable: number }[] = [];
            const linkIds = new Set<string>();
            const collectLinks = (node: DocumentNode): void => {
                if (node.type === "pageReference") {
                    const attrs = node.attrs!;
                    const target = this.get(String(attrs.targetId));
                    const linkId = typeof attrs.linkId === "string" && /^[a-zA-Z0-9_-]+$/.test(attrs.linkId) && !linkIds.has(attrs.linkId) ? attrs.linkId : randomUUID();
                    linkIds.add(linkId);
                    node.attrs = { ...attrs, linkId, title: target.title };
                    links.push({ id: linkId, target: target.id, block: attrs.blockId ? String(attrs.blockId) : null, mode: String(attrs.mode), writable: attrs.writable ? 1 : 0 });
                }
                node.content?.forEach(collectLinks);
            };
            document.content.forEach(collectLinks);
            // Link rows belong to one source. A pasted ID cannot update another page's link.
            this.database.prepare("DELETE FROM page_links WHERE source_id = ?").run(input.id);
            for (const link of links) {
                if (this.database.prepare("SELECT 1 FROM page_links WHERE id = ?").get(link.id)) {
                    const oldId = link.id;
                    link.id = randomUUID();
                    const replace = (node: DocumentNode): void => { if (node.attrs?.linkId === oldId) node.attrs.linkId = link.id; node.content?.forEach(replace); };
                    document.content.forEach(replace);
                }
                this.database.prepare("INSERT INTO page_links (id, source_id, target_id, block_id, mode, writable) VALUES (?, ?, ?, ?, ?, ?)").run(link.id, input.id, link.target, link.block, link.mode, link.writable);
            }
            for (const node of document.content) {
                const existingId = typeof node.attrs?.uid === "string" ? node.attrs.uid : "";
                const availableId = /^[0-9a-f-]{36}$/i.test(existingId) && (oldIds.has(existingId) || !this.database.prepare("SELECT 1 FROM blocks WHERE id = ?").get(existingId));
                const blockId = availableId && !ids.includes(existingId) ? existingId : randomUUID();
                node.attrs = { ...node.attrs, uid: blockId };
                ids.push(blockId);
                this.database.prepare("INSERT INTO blocks (id, type, content) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET type = excluded.type, content = excluded.content").run(blockId, node.type, JSON.stringify(node));
            }
            this.database.prepare("UPDATE blocks SET content = ? WHERE id = ?").run(title, row.title_block_id);
            this.database.prepare("UPDATE pages SET children = ? WHERE id = ?").run(JSON.stringify(ids), input.id);
            for (const id of oldIds) {
                if (!ids.includes(id)) this.database.prepare("DELETE FROM blocks WHERE id = ? AND NOT EXISTS (SELECT 1 FROM block_uses WHERE block_id = ?) AND NOT EXISTS (SELECT 1 FROM page_links WHERE block_id = ?)").run(id, id, id);
            }
            this.database.prepare("DELETE FROM page_tags WHERE page_id = ?").run(input.id);
            for (const tag of tags) {
                this.database.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(tag);
                this.database.prepare("INSERT INTO page_tags (page_id, name) VALUES (?, ?)").run(input.id, tag);
            }
            const definitions = this.properties();
            for (const [id, value] of Object.entries(properties)) {
                const definition = definitions.find(item => item.id === id);
                if (!definition) throw new Error("自定义属性已删除，请刷新后重试。");
                if (value !== null && ((definition.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) || (definition.type === "boolean" && typeof value !== "boolean") || (["string", "date"].includes(definition.type) && typeof value !== "string"))) throw new Error(`属性“${definition.name}”的值与类型不匹配。`);
                if (typeof value === "string") text(value, 10000);
                if (definition.type === "date" && value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`属性“${definition.name}”需要有效的日期。`);
                this.database.prepare("INSERT INTO page_attrs (page_id, attr_id, value) VALUES (?, ?, ?) ON CONFLICT (page_id, attr_id) DO UPDATE SET value = excluded.value").run(input.id, id, typeof value === "boolean" ? Number(value) : value);
            }
            this.database.prepare(`UPDATE page_details SET updated_at = ?, revision = revision + 1, independent = ?, pinned = ?, search_text = ?, paper = ?, schedule = ? WHERE page_id = ?`).run(
                new Date().toISOString(), Number(input.independent), Number(input.pinned), `${documentText(document)}\n${Object.values(properties).filter(value => value !== null).join(" ")}`,
                paper ? JSON.stringify(paper) : null, schedule ? JSON.stringify(schedule) : null, input.id
            );
            this.collectOrphans();
            return this.get(input.id);
        })();
    }

    updateMany(ids: string[], changes: PageChanges): void {
        this.validateIds(ids); object(changes);
        const addTags = this.validateTags(changes.addTags ?? []), removeTags = this.validateTags(changes.removeTags ?? []);
        if (changes.properties) object(changes.properties);
        if ((changes.independent !== undefined && typeof changes.independent !== "boolean") || (changes.pinned !== undefined && typeof changes.pinned !== "boolean")) throw new Error("无效的批量页面属性。");
        this.database.transaction(() => {
            for (const id of ids) {
                const page = this.get(id);
                this.save({ ...page, tags: [...new Set([...page.tags.filter(tag => !removeTags.includes(tag)), ...addTags])], properties: { ...page.properties, ...changes.properties }, independent: changes.independent ?? page.independent, pinned: changes.pinned ?? page.pinned });
            }
        })();
    }

    trash(ids: string[]): void {
        this.validateIds(ids);
        this.database.transaction(() => {
            for (const id of ids) { this.get(id); this.setDeleted(id, true); }
            this.collectOrphans();
        })();
    }

    restore(ids: string[]): void {
        this.validateIds(ids);
        this.database.transaction(() => {
            for (const id of ids) {
                this.get(id);
                this.setDeleted(id, false);
                // Restoration must not immediately orphan the page again.
                this.database.prepare("UPDATE page_details SET independent = 1 WHERE page_id = ?").run(id);
            }
        })();
    }

    private setDeleted(id: string, deleted: boolean): void {
        this.database.prepare("UPDATE page_attrs SET value = ? WHERE page_id = ? AND attr_id = 'deleted'").run(Number(deleted), id);
        this.database.prepare("UPDATE page_details SET updated_at = ?, revision = revision + 1 WHERE page_id = ?").run(new Date().toISOString(), id);
        if (deleted) this.database.prepare("DELETE FROM reminders WHERE page_id = ?").run(id);
    }

    private collectOrphans(): void {
        const rows = this.database.prepare<[], { id: string }>(`WITH RECURSIVE retained(id) AS (
            SELECT p.id ${summaryFrom} WHERE d.independent = 1 AND COALESCE(deleted.value, 0) = 0
            UNION
            SELECT link.target_id FROM page_links link JOIN retained ON retained.id = link.source_id
            JOIN page_attrs target ON target.page_id = link.target_id AND target.attr_id = 'deleted' AND COALESCE(target.value, 0) = 0
        ) SELECT p.id ${summaryFrom} WHERE d.independent = 0 AND COALESCE(deleted.value, 0) = 0 AND p.id NOT IN (SELECT id FROM retained)`).all();
        for (const row of rows) this.setDeleted(row.id, true);
    }

    backlinks(id: string): LinkRecord[] {
        this.get(id);
        return this.database.prepare<[string], Omit<LinkRecord, "writable" | "deleted"> & { writable: number; deleted: number }>(`SELECT l.id, l.source_id AS sourceId, l.target_id AS targetId, l.block_id AS blockId, l.mode, l.writable,
            title.content AS title, COALESCE(deleted.value, 0) AS deleted
            FROM page_links l JOIN pages p ON p.id = l.source_id JOIN blocks title ON title.id = p.title_block_id
            LEFT JOIN page_attrs deleted ON deleted.page_id = p.id AND deleted.attr_id = 'deleted' WHERE l.target_id = ?`).all(id).map(row => ({ ...row, writable: !!row.writable, deleted: !!row.deleted }));
    }

    tags(): string[] {
        return this.database.prepare<[], { name: string }>("SELECT name FROM tags ORDER BY name COLLATE NOCASE").all().map(row => row.name);
    }

    renameTag(oldName: string, newName: string): void {
        text(oldName, 100, false);
        newName = text(newName, 100, false).trim();
        if (oldName === newName) return;
        this.database.transaction(() => {
            const ids = this.database.prepare<[string], { page_id: string }>("SELECT page_id FROM page_tags WHERE name = ?").all(oldName);
            this.database.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(newName);
            this.database.prepare("INSERT OR IGNORE INTO page_tags (page_id, name) SELECT page_id, ? FROM page_tags WHERE name = ?").run(newName, oldName);
            this.database.prepare("DELETE FROM tags WHERE name = ?").run(oldName);
            for (const row of ids) this.touch(row.page_id);
        })();
    }

    removeTag(name: string): void {
        text(name, 100, false);
        this.database.transaction(() => {
            const ids = this.database.prepare<[string], { page_id: string }>("SELECT page_id FROM page_tags WHERE name = ?").all(name);
            this.database.prepare("DELETE FROM tags WHERE name = ?").run(name);
            for (const row of ids) this.touch(row.page_id);
        })();
    }

    properties(): PropertyDefinition[] {
        return this.database.prepare<[], { id: string; type: PropertyDefinition["type"]; metadata: string }>("SELECT id, type, metadata FROM attrs WHERE id LIKE 'custom:%' ORDER BY id").all().map(row => ({ id: row.id, type: row.type, name: JSON.parse(row.metadata).name ?? row.id }));
    }

    saveProperty(input: PropertyDefinition): void {
        object(input);
        identifier(input.id);
        if (!input.id.startsWith("custom:") || !["string", "number", "boolean", "date"].includes(input.type)) throw new Error("只能创建或编辑自定义属性。");
        const name = text(input.name, 100, false).trim();
        const existing = this.properties().find(item => item.id === input.id);
        if (existing && existing.type !== input.type) throw new Error("已有属性不能更改类型，以免损坏已保存的值。");
        this.database.prepare("INSERT INTO attrs (id, type, metadata) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET metadata = excluded.metadata").run(input.id, input.type, JSON.stringify({ name }));
    }

    removeProperty(id: string): void {
        if (!identifier(id).startsWith("custom:")) throw new Error("不能删除内置属性。");
        this.database.transaction(() => {
            const ids = this.database.prepare<[string], { page_id: string }>("SELECT page_id FROM page_attrs WHERE attr_id = ?").all(id);
            this.database.prepare("DELETE FROM page_attrs WHERE attr_id = ?").run(id);
            this.database.prepare("DELETE FROM attrs WHERE id = ?").run(id);
            for (const row of ids) {
                const page = this.get(row.page_id);
                this.database.prepare("UPDATE page_details SET search_text = ? WHERE page_id = ?").run(`${documentText(page.document)}\n${Object.values(page.properties).filter(value => value !== null).join(" ")}`, page.id);
                this.touch(row.page_id);
            }
        })();
    }

    visit(id: string): void {
        if (this.get(id).deleted) return;
        this.database.prepare("INSERT INTO visits (page_id, visited_at) VALUES (?, ?) ON CONFLICT (page_id) DO UPDATE SET visited_at = excluded.visited_at").run(id, new Date().toISOString());
    }

    clearHistory(id?: string): void {
        if (id !== undefined) this.database.prepare("DELETE FROM visits WHERE page_id = ?").run(identifier(id));
        else this.database.prepare("DELETE FROM visits").run();
    }

    recent(): PageSummary[] {
        return this.database.prepare<[], SummaryRow>(`SELECT ${summaryColumns} ${summaryFrom} JOIN visits v ON v.page_id = p.id WHERE COALESCE(deleted.value, 0) = 0 ORDER BY v.visited_at DESC LIMIT 12`).all().map(summary);
    }

    reminders(now = new Date()): Reminder[] {
        const pages = this.database.prepare<[], { page_id: string; schedule: string }>(`SELECT d.page_id, d.schedule FROM page_details d JOIN page_attrs a ON a.page_id = d.page_id AND a.attr_id = 'deleted' WHERE COALESCE(a.value, 0) = 0 AND d.schedule IS NOT NULL`).all();
        for (const row of pages) {
            const schedule = JSON.parse(row.schedule) as Schedule;
            if (schedule.status !== "done" && schedule.reminder && scheduleTime(schedule.reminder, schedule.timezone) <= now.getTime()) {
                this.database.prepare("INSERT OR IGNORE INTO reminders (id, page_id, scheduled_at) VALUES (?, ?, ?)").run(randomUUID(), row.page_id, schedule.reminder);
            }
        }
        return this.database.prepare<[], Omit<Reminder, "read"> & { read: number }>(`SELECT r.id, r.page_id AS pageId, b.content AS title, r.scheduled_at AS time, r.is_read AS read
            FROM reminders r JOIN pages p ON p.id = r.page_id JOIN blocks b ON b.id = p.title_block_id
            JOIN page_details d ON d.page_id = p.id JOIN page_attrs a ON a.page_id = p.id AND a.attr_id = 'deleted'
            WHERE COALESCE(a.value, 0) = 0 AND json_extract(d.schedule, '$.status') != 'done'
                AND json_extract(d.schedule, '$.reminder') = r.scheduled_at AND r.is_read = 0 ORDER BY r.scheduled_at DESC`).all().map(row => ({ ...row, read: !!row.read }));
    }

    dismissReminder(id: string): void {
        this.database.prepare("UPDATE reminders SET is_read = 1 WHERE id = ?").run(identifier(id));
    }

    private touch(id: string): void {
        this.database.prepare("UPDATE page_details SET revision = revision + 1, updated_at = ? WHERE page_id = ?").run(new Date().toISOString(), id);
    }

    private validateTags(value: unknown): string[] {
        if (!Array.isArray(value) || value.length > 100) throw new Error("标签不能超过 100 个。");
        return [...new Set(value.map(tag => text(tag, 100, false).trim()))];
    }

    private validateIds(value: unknown): asserts value is string[] {
        if (!Array.isArray(value) || value.length > 500) throw new Error("一次最多处理 500 个页面。");
        value.forEach(identifier);
    }
}