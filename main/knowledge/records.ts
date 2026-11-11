import type Database from "better-sqlite3";
import { search } from "../../shared/attrs/format";
import { resolveTimeZone } from "../../shared/content/time";
import { decodeValue, encodeValue, record, validUUID } from "../../shared/attrs/values";
import { blockText, payload, validateBlock } from "../../shared/content/blocks";
import { PDF_EXTRACTOR_VERSION } from "../../shared/content/pdf-text";
import { pageKinds, type ContentBlock, type PageKind, type PageList, type PageQuery, type PageRecord, type PageObjects, type PageSummary, type Target } from "../../shared/types/content";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { type WorkspaceDatabase } from "../storage/database";
import { type blocks, type pages } from "../storage/tables";
import { AttributeService } from "./attributes";

export type BlockRow = typeof blocks.$inferSelect;
export type PageRow = typeof pages.$inferSelect;
export type LinkRow = { sourceKind: Target["kind"]; sourceId: string; sourceField: string; targetKind: Target["kind"]; targetId: string };
export type Use = { kind: Target["kind"]; id: string; slot: string; position: number };
const linkColumns = "source_kind AS sourceKind, source_id AS sourceId, source_field AS sourceField, target_kind AS targetKind, target_id AS targetId";
type RawBlock = Omit<BlockRow, "children"> & { children: string };
type ListRow = { id: string; kind: PageKind; titleBlockId: string; children: string; total?: number };

export function decodeBlock(row: BlockRow): ContentBlock {
    const type = row.type as ContentBlock["type"];
    let body = payload(type, row.content ?? "");
    if (type === "blocked_reference") body.target = null;
    let value: unknown;
    if (row.content?.trimStart().startsWith("{")) {
        try { value = JSON.parse(row.content); }
        catch { /* Early workspaces stored plain text verbatim. */ }
    }
    if (record(value) && value.type === type && "schemaVersion" in value) {
        if (value.schemaVersion !== 1) throw new Error("块内容来自不支持的格式版本，原内容未被修改。");
        body = value as ContentBlock["payload"];
    }
    const block: ContentBlock = { id: row.id, type, payload: body, children: row.children };
    validateBlock(block);
    return block;
}

export class KnowledgeRecords {
    readonly sql: Database.Database;
    readonly attributes: AttributeService;
    private readonly prepared = new Map<string, Database.Statement>();

    constructor(readonly db: WorkspaceDatabase, private readonly timeZone: () => string = () => "system") {
        this.sql = db.$client;
        this.attributes = new AttributeService(db);
        this.sql.function("knowledge_text", { deterministic: true }, (type: string, content: string | null) => {
            if (!content) return "";
            if (!content.trimStart().startsWith("{")) return content;
            let body: ContentBlock["payload"];
            try { body = JSON.parse(content); }
            catch { return content; }
            return body?.schemaVersion === 1 && body.type === type && Array.isArray(body.inline) ? blockText({ id: "", type: body.type, payload: body, children: [] }) : content;
        });
        const definitions = new Map<string, { metadata: string; definition: AttributeDefinition }>();
        this.sql.function("knowledge_search", { deterministic: true }, (id: string, type: AttributeDefinition["type"], metadata: string, stored: unknown, zone: string) => {
            let cached = definitions.get(id);
            if (!cached || cached.metadata !== metadata || cached.definition.type !== type) {
                cached = { metadata, definition: { id, type, metadata: JSON.parse(metadata) } };
                definitions.set(id, cached);
            }
            return search(cached.definition, decodeValue(cached.definition, stored), { zone }).toLocaleLowerCase();
        });
        this.sql.function("knowledge_lower", { deterministic: true }, (value: string) => value.toLocaleLowerCase());
    }

    statement(sql: string): Database.Statement {
        let statement = this.prepared.get(sql);
        if (!statement) {
            statement = this.sql.prepare(sql);
            this.prepared.set(sql, statement);
        }
        return statement;
    }

    header(id: string): Omit<PageRow, "children"> {
        if (!validUUID(id)) throw new Error("页面 UUID 无效。");
        const row = this.statement("SELECT id, kind, title_block_id AS titleBlockId FROM pages WHERE id = ?").get(id) as Omit<PageRow, "children"> | undefined;
        if (!row || !pageKinds.includes(row.kind as PageKind)) throw new Error("页面不存在或类型不受支持。");
        return row;
    }

    children(target: Target): string[] {
        const table = target.kind === "page" ? "pages" : "blocks";
        const row = this.statement("SELECT children FROM " + table + " WHERE id = ?").get(target.id) as { children: string } | undefined;
        return row ? JSON.parse(row.children) : [];
    }

    blockRow(id: string): BlockRow | null {
        const row = this.statement("SELECT id, type, content, children FROM blocks WHERE id = ?").get(id) as RawBlock | undefined;
        return row ? { ...row, children: JSON.parse(row.children) } : null;
    }

    readBatch(ids: string[]): ContentBlock[] {
        const result: ContentBlock[] = [];
        const statement = this.statement("SELECT id, type, content, children FROM blocks WHERE id IN (SELECT value FROM json_each(?))");
        for (let i = 0; i < ids.length; i += 500) {
            for (const row of statement.all(JSON.stringify(ids.slice(i, i + 500))) as RawBlock[]) result.push(decodeBlock({ ...row, children: JSON.parse(row.children) }));
        }
        return result;
    }

    sharedUses(ids: string[]): Record<string, number> {
        const rows = this.statement(`SELECT block_id AS id, COUNT(*) AS n FROM block_uses WHERE block_id IN
            (SELECT value FROM json_each(?)) GROUP BY block_id HAVING COUNT(*) > 1`).all(JSON.stringify(ids)) as { id: string; n: number }[];
        return Object.fromEntries(rows.map(row => [row.id, row.n]));
    }

    readObjects(pageId: string, ids: string[]): PageObjects {
        const page = ids.includes(pageId) ? { children: this.children({ kind: "page", id: pageId }), attributes: this.valuesFor([pageId]).get(pageId) ?? {} } : undefined;
        const blocks = ids.filter(id => id !== pageId);
        return { page, blocks: this.readBatch(blocks), uses: this.sharedUses(blocks) };
    }

    uses(id: string): Use[] {
        return this.statement("SELECT container_kind AS kind, container_id AS id, slot, position FROM block_uses WHERE block_id = ?").all(id) as Use[];
    }

    owners(id: string): string[] {
        return this.statement(`WITH RECURSIVE parents(kind,id) AS (
            SELECT container_kind, container_id FROM block_uses WHERE block_id = ?
            UNION SELECT u.container_kind, u.container_id FROM parents p JOIN block_uses u ON u.block_id = p.id WHERE p.kind = 'block'
        ) SELECT id FROM parents WHERE kind = 'page'`).pluck().all(id) as string[];
    }

    outgoing(source: Target): LinkRow[] {
        return this.statement("SELECT " + linkColumns + " FROM link_index WHERE source_kind = ? AND source_id = ? AND retains = 1").all(source.kind, source.id) as LinkRow[];
    }

    incoming(target: Target): LinkRow[] {
        return this.statement("SELECT " + linkColumns + " FROM link_index WHERE target_kind = ? AND target_id = ? AND retains = 1").all(target.kind, target.id) as LinkRow[];
    }

    flags(id: string): { independent: boolean; deleted: boolean } {
        const state = this.statement("SELECT attr_id AS id, value FROM page_attrs WHERE page_id = ? AND attr_id IN ('independent','deleted')").all(id) as { id: string; value: number | null }[];
        return { independent: state.some(a => a.id === "independent" && a.value === 1), deleted: !state.length || state.some(a => a.id === "deleted" && a.value === 1) };
    }

    title(id: string): string {
        const row = this.statement("SELECT knowledge_text(b.type,b.content) AS title FROM pages p JOIN blocks b ON b.id = p.title_block_id WHERE p.id = ?").get(id) as { title: string } | undefined;
        return row?.title || "未命名";
    }

    valuesFor(ids: string[]): Map<string, Record<string, AttributeValue>> {
        const values = new Map<string, Record<string, AttributeValue>>();
        const rows = this.statement(`SELECT v.page_id AS pageId, v.attr_id AS id, v.value, a.type, a.metadata FROM page_attrs v
            JOIN attrs a ON a.id = v.attr_id WHERE v.page_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)) as { pageId: string; id: string; type: AttributeDefinition["type"]; metadata: string; value: unknown }[];
        const definitions = new Map<string, AttributeDefinition>();
        for (const row of rows) {
            let definition = definitions.get(row.id);
            if (!definition) {
                definition = { id: row.id, type: row.type, metadata: JSON.parse(row.metadata) };
                definitions.set(row.id, definition);
            }
            const attrs = values.get(row.pageId) ?? {};
            attrs[row.id] = decodeValue(definition, row.value);
            values.set(row.pageId, attrs);
        }
        return values;
    }

    get(id: string): PageRecord {
        const row = this.header(id), children = this.children({ kind: "page", id });
        const visible: Record<string, ContentBlock> = {};
        const seen = new Set<string>();
        let level = [row.titleBlockId, ...children];
        while (level.length) {
            const batch = [...new Set(level)].filter(id => !seen.has(id));
            for (const id of batch) seen.add(id);
            level = [];
            for (const block of this.readBatch(batch)) {
                visible[block.id] = block;
                for (const child of block.children) if (!seen.has(child)) level.push(child);
            }
        }
        const title = visible[row.titleBlockId];
        return { ...row, kind: row.kind as PageKind, children, title: title ? blockText(title) : "", excerpt: this.excerpt(children, visible),
            blocks: visible, sharedUses: this.sharedUses([...seen]), attributes: this.valuesFor([id]).get(id) ?? {} };
    }

    private contentText(block: ContentBlock): string {
        if (block.type === "source" && block.payload.source) {
            return this.statement("SELECT quote FROM anchors WHERE id=? AND extractor_version=?").pluck().get(block.payload.source.anchorId, PDF_EXTRACTOR_VERSION) as string ?? "";
        }
        return blockText(block);
    }

    private excerpt(ids: string[], blocks: Record<string, ContentBlock>): string {
        let text = "";
        for (const id of ids) {
            if (blocks[id]) text += (text ? " " : "") + this.contentText(blocks[id]);
            if (text.length >= 240) break;
        }
        return text.slice(0, 240);
    }

    private listRows(query: PageQuery): { selected: ListRow[]; total: number } {
        if (!record(query) || (query.kind && !pageKinds.includes(query.kind)) || (query.keyword !== undefined && typeof query.keyword !== "string") ||
            (query.pinned !== undefined && typeof query.pinned !== "boolean") || (query.deleted !== undefined && typeof query.deleted !== "boolean") ||
            (query.sort && !["modified", "created", "title"].includes(query.sort)) || (query.tags && (!Array.isArray(query.tags) || !query.tags.every(t => typeof t === "string"))) ||
            (query.attributes && !record(query.attributes))) throw new Error("页面查询无效。");
        const offset = query.offset ?? 0, limit = query.limit ?? 50;
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("分页范围无效。");
        const where = ["d.value = ?"], params: unknown[] = [Number(!!query.deleted)];
        if (query.ids !== undefined) {
            if (!Array.isArray(query.ids) || !query.ids.every(validUUID)) throw new Error("页面编号列表无效。");
            where.push("p.id IN (SELECT value FROM json_each(?))");
            params.push(JSON.stringify(query.ids));
        }
        if (query.kind) { where.push("p.kind = ?"); params.push(query.kind); }
        if (query.pinned !== undefined) {
            where.push("(SELECT value FROM page_attrs WHERE page_id=p.id AND attr_id='pinned') = ?");
            params.push(Number(query.pinned));
        }
        for (const tag of query.tags ?? []) {
            where.push("EXISTS (SELECT 1 FROM page_attrs a, json_each(a.value) j WHERE a.page_id=p.id AND a.attr_id='tags' AND j.value=?)");
            params.push(tag);
        }
        for (const [id, value] of Object.entries(query.attributes ?? {})) {
            where.push("EXISTS (SELECT 1 FROM page_attrs a WHERE a.page_id=p.id AND a.attr_id=? AND a.value IS ?)");
            params.push(id, encodeValue(this.attributes.definition(id), value));
        }
        const keyword = query.keyword?.trim().toLocaleLowerCase();
        let cte = "";
        if (keyword) {
            cte = `WITH RECURSIVE hits(kind,id) AS (
                SELECT 'block', b.id FROM blocks b LEFT JOIN anchors a ON b.type='source' AND a.extractor_version='${PDF_EXTRACTOR_VERSION}' AND a.id=CASE WHEN json_valid(b.content) THEN json_extract(b.content,'$.source.anchorId') END
                WHERE instr(knowledge_lower(CASE WHEN b.type='source' THEN coalesce(a.quote,'') ELSE knowledge_text(b.type,b.content) END), ?) > 0
                UNION SELECT u.container_kind, u.container_id FROM hits h JOIN block_uses u ON u.block_id=h.id WHERE h.kind='block'
            ), matches(id) AS (
                SELECT id FROM hits WHERE kind='page'
                UNION SELECT v.page_id FROM page_attrs v JOIN attrs a ON a.id=v.attr_id
                WHERE v.value IS NOT NULL AND instr(knowledge_search(a.id,a.type,a.metadata,v.value,?),?) > 0
            ) `;
            where.push("p.id IN (SELECT id FROM matches)");
            params.unshift(keyword, resolveTimeZone(this.timeZone()), keyword);
        }
        const from = " FROM pages p JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted'";
        const filter = " WHERE " + where.join(" AND ");
        const order = query.sort === "title" ? "knowledge_text(b.type,b.content) COLLATE NOCASE ASC" : "s.value DESC";
        const join = query.sort === "title" ? " JOIN blocks b ON b.id=p.title_block_id" :
            " JOIN page_attrs s ON s.page_id=p.id AND s.attr_id='" + (query.sort === "created" ? "created_at" : "modified_at") + "'";
        // Materialize keyword hits once. The window count precedes pagination.
        const count = keyword ? ", count(*) OVER() AS total" : "";
        const simple = !query.ids && !keyword && !query.kind && query.pinned === undefined && !query.tags?.length && !Object.keys(query.attributes ?? {}).length && query.sort !== "title";
        const dateId = query.sort === "created" ? "created_at" : "modified_at";
        const selected = (simple ? this.statement(`SELECT p.id, p.kind, p.title_block_id AS titleBlockId, p.children
            FROM page_attrs s INDEXED BY page_attrs_order CROSS JOIN pages p ON p.id=s.page_id
            JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted'
            WHERE s.attr_id=? AND d.value=? ORDER BY s.value DESC,s.page_id LIMIT ? OFFSET ?`).all(dateId, Number(!!query.deleted), limit, offset)
            : this.statement(cte + "SELECT p.id, p.kind, p.title_block_id AS titleBlockId, p.children" + count + from + join + filter +
            " ORDER BY " + order + ", p.id LIMIT ? OFFSET ?").all(...params, limit, offset)) as ListRow[];
        const total = simple ? this.statement("SELECT count(*) FROM page_attrs WHERE attr_id='deleted' AND value=?").pluck().get(Number(!!query.deleted)) as number : selected[0]?.total ?? (keyword && !offset ? 0 : this.statement(cte + "SELECT count(*)" + from + filter).pluck().get(...params) as number);
        return { selected, total };
    }

    private summaries(selected: ListRow[]): PageSummary[] {
        const heads = selected.map(p => ({ ...p, children: (JSON.parse(p.children) as string[]).slice(0, 4) }));
        const blocks = Object.fromEntries(this.readBatch([...new Set(heads.flatMap(p => [p.titleBlockId, ...p.children]))]).map(b => [b.id, b]));
        const attrs = this.valuesFor(heads.map(p => p.id));
        return heads.map(p => ({ id: p.id, kind: p.kind, title: blocks[p.titleBlockId] ? blockText(blocks[p.titleBlockId]) : "",
            excerpt: this.excerpt(p.children, blocks), attributes: attrs.get(p.id) ?? {} }));
    }

    list(query: PageQuery = {}): PageList {
        const { selected, total } = this.listRows(query);
        return { items: this.summaries(selected), total };
    }

    listUpdates(query: PageQuery, unchanged: string[]): PageList & { order: string[] } {
        if (!Array.isArray(unchanged) || unchanged.length > 200 || !unchanged.every(validUUID)) throw new Error("页面编号列表无效。");
        const { selected, total } = this.listRows(query), keep = new Set(unchanged);
        return { order: selected.map(row => row.id), items: this.summaries(selected.filter(row => !keep.has(row.id))), total };
    }
}