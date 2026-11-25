import type Database from "better-sqlite3";
import { resolveAttributeDefinition } from "../../shared/attrs/definitions";
import { unsearchableBuiltinValues } from "../../shared/attrs/builtins";
import { libraryText, search } from "../../shared/attrs/format";
import { attributeTargetKind, decodeValue, emptyValue, encodeValue, nullable, record, validUUID } from "../../shared/attrs/values";
import { blockText, payload, validateBlock, validTarget } from "../../shared/content/blocks";
import { matchRanges } from "../../shared/content/matches";
import type { MediaFile } from "../../shared/content/media";
import { isTimeType, resolveTimeZone, validTimeSeconds } from "../../shared/content/time";
import { LabloomError } from "../../shared/failure";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { pageKinds, type Backlink, type ContentBlock, type LinkTarget, type PageKind, type PageList, type PageObjects, type PageQuery, type PageRecord, type PageSummary, type PageSearchResult, type ResolvedTarget, type Target } from "../../shared/types/content";
import { type blocks, type pages } from "../storage/tables";
import { attachmentPath } from "../storage/files";
import * as workspace from "../workspace-state";

import { overviewBatchSize, type OverviewIndex, type OverviewPage, type OverviewQuery } from "../../shared/workspace/overview";
import type { CalendarPage, CalendarQuery } from "../../shared/workspace/calendar";
import { libraryBatchSize, type LibraryIndex, type LibraryQuery } from "../../shared/workspace/library";
import { createI18n, type Translate } from "../../shared/i18n";

export type BlockRow = typeof blocks.$inferSelect;
type PageRow = typeof pages.$inferSelect;
export type LinkRow = { sourceKind: Target["kind"]; sourceId: string; sourceField: string; targetKind: LinkTarget["kind"]; targetId: string };
export type Use = { kind: Target["kind"]; id: string; slot: string; position: number };
const linkColumns = "source_kind AS sourceKind, source_id AS sourceId, source_field AS sourceField, target_kind AS targetKind, target_id AS targetId";
type RawBlock = Omit<BlockRow, "children"> & { children: string };
type ListRow = { id: string; kind: PageKind; titleBlockId: string; children: string; total?: number };

export function decodeBlock(row: BlockRow): ContentBlock {
    const type = row.type as ContentBlock["type"];
    const body = row.content === null ? payload(type) : JSON.parse(row.content);
    if (row.content === null && type === "blocked_reference") body.target = null;
    if (record(body) && body.schemaVersion !== 1) throw new LabloomError({ kind: "block-unsupported-version" });
    const block: ContentBlock = { id: row.id, type, payload: body, children: row.children };
    validateBlock(block);
    return block;
}

const prepared = new Map<string, Database.Statement>();
export function initialize(): void {
    const sql = workspace.native();

    sql.function("knowledge_text", { deterministic: true }, (type: string, content: string | null) => {
        if (!content) return "";
        let body: ContentBlock["payload"];
        try {
            body = JSON.parse(content);
        }
        catch {
            return "";
        }
        return body?.schemaVersion === 1 && body.type === type && Array.isArray(body.inline) ? blockText({ id: "", type: body.type, payload: body, children: [] }) : "";
    });
    const definitions = new Map<string, { name: string | null; metadata: string; definition: AttributeDefinition }>();
    sql.function("knowledge_search", { deterministic: true }, (id: string, type: AttributeDefinition["type"], name: string | null, metadata: string, stored: unknown, zone: string, fileNames: string | null) => {
        let cached = definitions.get(id);
        if (!cached || cached.name !== name || cached.metadata !== metadata || cached.definition.type !== type) {
            cached = { name, metadata, definition: resolveAttributeDefinition({ id, type, name, metadata: JSON.parse(metadata) }) };
            definitions.set(id, cached);
        }
        const names: Record<string, string> = fileNames ? JSON.parse(fileNames) : {};
        return search(cached.definition, decodeValue(cached.definition, stored), { zone, fileName: id => names[id] });
    });
    sql.function("knowledge_lower", { deterministic: true }, (value: string) => value.toLocaleLowerCase());

}
export function release(): void {
    prepared.clear();
}
function definition(id: string): AttributeDefinition | undefined {
    const row = statement("SELECT id,type,name,metadata FROM attrs_meta WHERE id=?").get(id) as { id: string; type: AttributeDefinition["type"]; name: string | null; metadata: string } | undefined;
    return row && resolveAttributeDefinition({ ...row, metadata: JSON.parse(row.metadata) });
}
export function statement(sql: string): Database.Statement {
    workspace.requireWorkspace();
    let localStatement = prepared.get(sql);
    if (!localStatement) {
        localStatement = workspace.native().prepare(sql);
        prepared.set(sql, localStatement);
    }
    return localStatement;
}

type PageHeader = Pick<PageRow, "id" | "kind" | "titleBlockId">;
export function header(id: string): PageHeader {
    workspace.requireWorkspace();
    if (!validUUID(id)) throw new LabloomError({ kind: "page-invalid-id" });
    const row = statement("SELECT id, kind, title_block_id AS titleBlockId FROM pages WHERE id = ?").get(id) as PageHeader | undefined;
    if (!row || !pageKinds.includes(row.kind as PageKind)) throw new LabloomError({ kind: "page-unavailable" });
    return row;
}

export function writable(id: string): ReturnType<typeof header> {
    const page = header(id);
    if (flags(id).deleted) throw new LabloomError({ kind: "page-recycled-readonly" });
    return page;
}

export function children(target: Target): string[] {
    workspace.requireWorkspace();
    const table = target.kind === "page" ? "pages" : "blocks";
    const row = statement("SELECT children FROM " + table + " WHERE id = ?").get(target.id) as { children: string } | undefined;
    return row ? JSON.parse(row.children) : [];
}

export function blockRow(id: string): BlockRow | null {
    workspace.requireWorkspace();
    const row = statement("SELECT id, type, content, children FROM blocks WHERE id = ?").get(id) as RawBlock | undefined;
    return row ? { ...row, children: JSON.parse(row.children) } : null;
}

export function readBatch(ids: string[]): ContentBlock[] {
    workspace.requireWorkspace();
    const result: ContentBlock[] = [];
    const select = statement("SELECT id, type, content, children FROM blocks WHERE id IN (SELECT value FROM json_each(?))");
    for (let i = 0; i < ids.length; i += 500) {
        for (const row of select.all(JSON.stringify(ids.slice(i, i + 500))) as RawBlock[]) result.push(decodeBlock({ ...row, children: JSON.parse(row.children) }));
    }
    return result;
}

export function sharedUses(ids: string[]): Record<string, number> {
    workspace.requireWorkspace();
    const rows = statement(`SELECT block_id AS id, COUNT(*) AS n FROM sync_refs WHERE block_id IN
        (SELECT value FROM json_each(?)) GROUP BY block_id HAVING COUNT(*) > 1`).all(JSON.stringify(ids)) as { id: string; n: number }[];
    return Object.fromEntries(rows.map(row => [row.id, row.n]));
}

export function readObjects(pageId: string, ids: string[]): PageObjects {
    workspace.requireWorkspace();
    const page = ids.includes(pageId) ? { children: children({ kind: "page", id: pageId }), attributes: valuesFor([pageId]).get(pageId) ?? {} } : undefined;
    const blocks = ids.filter(id => id !== pageId);
    const content = readBatch(blocks), files = new Set<string>();
    for (const block of content) if (block.payload.media?.fileId) files.add(block.payload.media.fileId);
    return { page, blocks: content, uses: sharedUses(blocks), ...(files.size ? { mediaFiles: mediaFiles(files) } : {}) };
}

export function uses(id: string): Use[] {
    workspace.requireWorkspace();
    return statement("SELECT container_kind AS kind, container_id AS id, slot, position FROM sync_refs WHERE block_id = ?").all(id) as Use[];
}

export function owners(id: string): string[] {
    workspace.requireWorkspace();
    return statement(`WITH RECURSIVE parents(kind,id) AS (
        SELECT container_kind, container_id FROM sync_refs WHERE block_id = ?
        UNION SELECT u.container_kind, u.container_id FROM parents p JOIN sync_refs u ON u.block_id = p.id WHERE p.kind = 'block'
    ) SELECT id FROM parents WHERE kind = 'page'`).pluck().all(id) as string[];
}

export function outgoing(source: Target): LinkRow[] {
    workspace.requireWorkspace();
    return statement("SELECT " + linkColumns + " FROM link_refs WHERE source_kind = ? AND source_id = ?").all(source.kind, source.id) as LinkRow[];
}

export function incoming(target: LinkTarget): LinkRow[] {
    workspace.requireWorkspace();
    return statement("SELECT " + linkColumns + " FROM link_refs WHERE target_kind = ? AND target_id = ?").all(target.kind, target.id) as LinkRow[];
}

export function flags(id: string): { independent: boolean; deleted: boolean } {
    workspace.requireWorkspace();
    const state = statement("SELECT attr_id AS id, value FROM page_attrs WHERE page_id = ? AND attr_id IN ('independent','deleted')").all(id) as { id: string; value: number | null }[];
    return { independent: state.some(a => a.id === "independent" && a.value === 1), deleted: !state.length || state.some(a => a.id === "deleted" && a.value === 1) };
}

export function title(id: string, fallback = "未命名"): string {
    workspace.requireWorkspace();
    const row = statement("SELECT knowledge_text(b.type,b.content) AS title FROM pages p JOIN blocks b ON b.id = p.title_block_id WHERE p.id = ?").get(id) as { title: string } | undefined;
    return row?.title || fallback;
}

export function valuesFor(ids: string[]): Map<string, Record<string, AttributeValue>> {
    workspace.requireWorkspace();
    const values = new Map<string, Record<string, AttributeValue>>();
    const rows = statement(`SELECT v.page_id AS pageId, v.attr_id AS id, v.value, a.type, a.name, a.metadata FROM page_attrs v
        JOIN attrs_meta a ON a.id = v.attr_id WHERE v.page_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)) as { pageId: string; id: string; type: AttributeDefinition["type"]; name: string | null; metadata: string; value: unknown }[];
    const definitions = new Map<string, AttributeDefinition>();
    for (const row of rows) {
        let localDefinition = definitions.get(row.id);
        if (!localDefinition) {
            localDefinition = resolveAttributeDefinition({ ...row, metadata: JSON.parse(row.metadata) });
            definitions.set(row.id, localDefinition);
        }
        const attrs = values.get(row.pageId) ?? {};
        attrs[row.id] = decodeValue(localDefinition, row.value);
        values.set(row.pageId, attrs);
    }
    return values;
}

export function get(id: string): PageRecord {
    workspace.requireWorkspace();
    const row = header(id), pageChildren = children({ kind: "page", id });
    const visible: Record<string, ContentBlock> = {};
    const seen = new Set<string>();
    let files: Set<string> | undefined;
    let level = [row.titleBlockId, ...pageChildren];
    while (level.length) {
        const batch = [...new Set(level)].filter(id => !seen.has(id));
        for (const id of batch) seen.add(id);
        level = [];
        for (const block of readBatch(batch)) {
            visible[block.id] = block;
            if (block.payload.media?.fileId) (files ??= new Set()).add(block.payload.media.fileId);
            for (const child of block.children) if (!seen.has(child)) level.push(child);
        }
    }
    const localTitle = visible[row.titleBlockId];
    return {
        ...row, kind: row.kind as PageKind, children: pageChildren, title: localTitle ? blockText(localTitle) : "", excerpt: excerpt(pageChildren, visible),
        blocks: visible, sharedUses: sharedUses([...seen]), attributes: valuesFor([id]).get(id) ?? {},
        ...(files ? { mediaFiles: mediaFiles(files) } : {})
    };
}

function mediaFiles(ids: Set<string>): Record<string, MediaFile> {
    const root = workspace.root();
    const rows = statement(`SELECT id, original_name AS originalName, media_type AS mediaType, size, stored_name AS storedName
        FROM attachments WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...ids])) as (Omit<MediaFile, "path"> & { storedName: string })[];
    return Object.fromEntries(rows.map(({ storedName, ...file }) => [file.id, { ...file, path: attachmentPath(root, storedName) }]));
}

function excerpt(ids: string[], blocks: Record<string, ContentBlock>): string {
    let text = "";
    for (const id of ids) {
        if (blocks[id]) text += (text ? " " : "") + blockText(blocks[id]);
        if (text.length >= 240) break;
    }
    return text.slice(0, 240);
}

export function bodyExcerpts(rows: { id: string; children: string[] }[]): Map<string, string> {
    const blocks = Object.fromEntries(readBatch([...new Set(rows.flatMap(row => row.children))]).map(block => [block.id, block]));
    return new Map(rows.map(row => [row.id, excerpt(row.children, blocks)]));
}

// The same formatted attribute value can belong to many pages (tags, dates, options).
// Format each distinct value once, then use page_attrs_by_value to find its pages.
const attributeHits = `distinct_values AS MATERIALIZED (
    SELECT attr_id, value FROM page_attrs WHERE attr_id IN (
        SELECT id FROM attrs_meta WHERE id NOT IN (${unsearchableBuiltinValues.map(id => "'" + id + "'").join(",")})
    ) AND value IS NOT NULL GROUP BY attr_id, value
), matched_values AS MATERIALIZED (
    SELECT v.attr_id, v.value FROM distinct_values v JOIN attrs_meta a ON a.id=v.attr_id
    WHERE instr(knowledge_lower(${attributeText()}), @keyword)>0
), attribute_hits AS (
    SELECT p.page_id AS id, min(m.attr_id) AS attr FROM matched_values m
    JOIN page_attrs p ON p.attr_id=m.attr_id AND p.value=m.value GROUP BY p.page_id
)`;

function attributeText(): string {
    // Searchable strings and URLs already contain their exact display text in SQLite.
    return `CASE WHEN a.type IN ('string','url') THEN v.value ELSE knowledge_search(a.id,a.type,a.name,a.metadata,v.value,@zone,
        CASE WHEN a.type IN ('file','files') THEN (
            SELECT json_group_object(f.id,f.original_name) FROM attachments f
            JOIN json_each(CASE a.type WHEN 'file' THEN json_array(v.value) ELSE v.value END) j ON j.value=f.id
        ) END) END`;
}

const blockHits = `file_hits(id, name) AS MATERIALIZED (
    SELECT l.source_id, f.original_name FROM attachments f CROSS JOIN link_refs l
    ON l.target_kind='file' AND l.target_id=f.id AND l.source_kind='block'
    WHERE instr(knowledge_lower(f.original_name), @keyword)>0
    UNION ALL
    SELECT b.id, b.content ->> '$.media.name' FROM blocks b WHERE b.type IN ('image','video','file')
        AND b.content ->> '$.media.fileId' IS NULL AND instr(knowledge_lower(coalesce(b.content ->> '$.media.name', '')), @keyword)>0
), block_hits(id) AS MATERIALIZED (
    SELECT b.id FROM blocks b WHERE instr(knowledge_lower(knowledge_text(b.type,b.content)), @keyword)>0
    UNION SELECT id FROM file_hits
), owners(kind,id) AS (
    SELECT 'block', id FROM block_hits
    UNION SELECT u.container_kind,u.container_id FROM owners o JOIN sync_refs u ON u.block_id=o.id WHERE o.kind='block'
)`;
const searchMatches = `WITH RECURSIVE ${blockHits}, ${attributeHits}, matches(id) AS (
    SELECT id FROM owners WHERE kind='page' UNION SELECT id FROM attribute_hits
) `;

function listFilter(query: Omit<PageQuery, "sort">, bindings: Record<string, string> = {}): { from: string; filter: string; cte: string; params: unknown[]; keyword?: string } | null {
    const where = ["d.value = ?"], params: unknown[] = [Number(!!query.deleted)];
    if (query.ids !== undefined) {
        if (!Array.isArray(query.ids) || !query.ids.every(validUUID)) throw new LabloomError({ kind: "page-invalid-ids" });
        where.push("p.id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(query.ids));
    }
    if (query.kind) {
        where.push("p.kind = ?"); params.push(query.kind);
    }
    if (query.pinned !== undefined) {
        where.push("p.id IN (SELECT page_id FROM page_attrs WHERE attr_id='pinned' AND value=?)");
        params.push(Number(query.pinned));
    }
    for (const tag of query.tags ?? []) {
        where.push("EXISTS (SELECT 1 FROM page_attrs a, json_each(a.value) j WHERE a.page_id=p.id AND a.attr_id='tags' AND j.value=?)");
        params.push(tag);
    }
    if (query.hasValue !== undefined) {
        const attr = definition(query.hasValue);
        if (!attr) return null;
        const compare = nullable(attr.type);
        where.push("EXISTS (SELECT 1 FROM page_attrs a WHERE a.page_id=p.id AND a.attr_id=?" + (compare ? " AND a.value IS NOT ?" : "") + ")");
        params.push(attr.id);
        if (compare) params.push(encodeValue(attr, emptyValue(attr.type)));
    }
    for (const [id, value] of Object.entries(query.attributes ?? {})) {
        const attr = definition(id);
        if (!attr) return null;
        where.push("p.id IN (SELECT page_id FROM page_attrs WHERE attr_id=? AND value IS ?)");
        params.push(id, encodeValue(attr, value));
    }
    const keyword = query.keyword?.trim().toLocaleLowerCase();
    let cte = "";
    if (keyword) {
        cte = searchMatches;
        where.push("p.id IN (SELECT id FROM matches)");
        bindings.keyword = keyword;
        bindings.zone = resolveTimeZone(workspace.timeZone());
    }
    if (Object.keys(bindings).length) params.unshift(bindings);
    const from = " FROM pages p JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted'";
    const filter = " WHERE " + where.join(" AND ");
    return { from, filter, cte, params, keyword };
}

function listRows(query: PageQuery): { selected: ListRow[]; total: number } {
    if (!record(query) || (query.kind && !pageKinds.includes(query.kind)) || (query.keyword !== undefined && typeof query.keyword !== "string") ||
        (query.pinned !== undefined && typeof query.pinned !== "boolean") || (query.deleted !== undefined && typeof query.deleted !== "boolean") ||
        (query.sort && !["modified", "created", "title"].includes(query.sort)) || (query.tags && (!Array.isArray(query.tags) || !query.tags.every(t => typeof t === "string"))) ||
        (query.attributes && !record(query.attributes))) throw new LabloomError({ kind: "page-invalid-query" });
    const offset = query.offset ?? 0, limit = query.limit ?? 50;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) throw new LabloomError({ kind: "page-invalid-range" });
    const parts = listFilter(query);
    if (!parts) return { selected: [], total: 0 };
    const { cte, from, filter, params, keyword } = parts;
    const order = query.sort === "title" ? "knowledge_text(b.type,b.content) COLLATE NOCASE ASC" : "s.value DESC";
    const join = query.sort === "title" ? " JOIN blocks b ON b.id=p.title_block_id" :
        " JOIN page_attrs s ON s.page_id=p.id AND s.attr_id='" + (query.sort === "created" ? "created_at" : "modified_at") + "'";
    // Materialize keyword hits once. The window count precedes pagination.
    const count = keyword ? ", count(*) OVER() AS total" : "";
    const dateOrdered = query.hasValue === undefined && !query.ids && !keyword && query.pinned === undefined && !query.tags?.length && !Object.keys(query.attributes ?? {}).length && query.sort !== "title";
    const dateId = query.sort === "created" ? "created_at" : "modified_at";
    const selected = (dateOrdered ? statement(`SELECT p.id, p.kind, p.title_block_id AS titleBlockId, p.children
        FROM page_attrs s INDEXED BY page_attrs_order CROSS JOIN pages p ON p.id=s.page_id AND s.attr_id=?
        JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted'${filter} ORDER BY s.value DESC,s.page_id LIMIT ? OFFSET ?`).all(dateId, ...params, limit, offset)
        : statement(cte + "SELECT p.id, p.kind, p.title_block_id AS titleBlockId, p.children" + count + from + join + filter +
            " ORDER BY " + order + ", p.id LIMIT ? OFFSET ?").all(...params, limit, offset)) as ListRow[];
    const total = dateOrdered && !query.kind ? statement("SELECT count(*) FROM page_attrs WHERE attr_id='deleted' AND value=?").pluck().get(Number(!!query.deleted)) as number : selected[0]?.total ?? (keyword && !offset ? 0 : statement(cte + "SELECT count(*)" + from + filter).pluck().get(...params) as number);
    return { selected, total };
}

function summaries(selected: ListRow[]): PageSummary[] {
    const heads = selected.map(p => ({ ...p, children: (JSON.parse(p.children) as string[]).slice(0, 4) }));
    const blocks = Object.fromEntries(readBatch([...new Set(heads.flatMap(p => [p.titleBlockId, ...p.children]))]).map(b => [b.id, b]));
    const attrs = valuesFor(heads.map(p => p.id));
    return heads.map(p => ({
        id: p.id, kind: p.kind, title: blocks[p.titleBlockId] ? blockText(blocks[p.titleBlockId]) : "",
        excerpt: excerpt(p.children, blocks), attributes: attrs.get(p.id) ?? {}
    }));
}

export function list(query: PageQuery = {}): PageList {
    workspace.requireWorkspace();
    const { selected, total } = listRows(query);
    return { items: summaries(selected), total };
}

type SearchRow = ListRow & { field: "title" | "body" | "attribute"; attr: string | null; name: string | null; text: string | null };

// Within each selected page follow only the first matching branch, in document order.
// UNION in owners deduplicates shared subtrees regardless of how often they occur.
const searchSQL = searchMatches + `, ranked AS MATERIALIZED (
    SELECT p.id, p.kind, p.title_block_id AS titleBlockId, p.children, a.attr, s.value AS modified,
        CASE WHEN p.title_block_id IN block_hits THEN 'title'
             WHEN p.id IN (SELECT id FROM owners WHERE kind='page') THEN 'body' ELSE 'attribute' END AS field,
        count(*) OVER() AS total
    FROM matches m JOIN pages p ON p.id=m.id
    JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted' AND d.value=0
    JOIN page_attrs s ON s.page_id=p.id AND s.attr_id='modified_at'
    LEFT JOIN attribute_hits a ON a.id=p.id
    ORDER BY (field='title') DESC, s.value DESC, p.id LIMIT @limit OFFSET @offset
), walk(page,kind,id) AS (
    SELECT id,'page',id FROM ranked WHERE field='body'
    UNION ALL
    SELECT w.page,'block',(
        SELECT r.block_id FROM sync_refs r
        WHERE r.container_kind=w.kind AND r.container_id=w.id AND r.slot='children'
          AND r.block_id IN (SELECT id FROM owners WHERE kind='block') ORDER BY r.position LIMIT 1
    ) FROM walk w WHERE w.kind='page' OR w.id NOT IN block_hits
), body AS (
    SELECT w.page, coalesce(f.name, knowledge_text(b.type,b.content)) AS text
    FROM walk w JOIN blocks b ON b.id=w.id LEFT JOIN file_hits f ON f.id=b.id WHERE w.kind='block' AND w.id IN block_hits
)
SELECT r.*, a.name, CASE r.field WHEN 'body' THEN b.text
    WHEN 'attribute' THEN ${attributeText()} END AS text FROM ranked r
LEFT JOIN body b ON b.page=r.id
LEFT JOIN page_attrs v ON r.field='attribute' AND v.page_id=r.id AND v.attr_id=r.attr
LEFT JOIN attrs_meta a ON a.id=v.attr_id
ORDER BY (r.field='title') DESC, r.modified DESC, r.id`;

export function searchPages(keyword: string, offset = 0, limit = 30): { items: PageSearchResult[]; total: number } {
    workspace.requireWorkspace();
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new LabloomError({ kind: "page-invalid-range" });
    keyword = keyword.trim().toLocaleLowerCase();
    if (!keyword) return { items: [], total: 0 };
    const params = { keyword, zone: resolveTimeZone(workspace.timeZone()) };
    const rows = statement(searchSQL).all({ ...params, offset, limit }) as SearchRow[];
    const pages = summaries(rows);
    const items = rows.map((row, index): PageSearchResult => {
        const page = pages[index];
        if (row.field === "title") return { ...page, match: { field: "title" } };
        const snippet = matchSnippet(row.text!, keyword);
        if (row.field === "body") return { ...page, match: { field: "body", snippet } };
        const id = row.attr!;
        return { ...page, match: { field: "attribute", id, name: row.name ?? definition(id)!.name, snippet } };
    });
    const total = rows[0]?.total ?? (offset ? statement(searchMatches +
        "SELECT count(*) FROM matches m JOIN page_attrs d ON d.page_id=m.id AND d.attr_id='deleted' AND d.value=0").pluck().get(params) as number : 0);
    return { items, total };
}

function matchSnippet(text: string, keyword: string): string {
    const [first, last] = matchRanges(text, keyword).next().value!;
    let start = Math.max(0, first - 36), end = Math.min(text.length, last + 36);
    if (start && /[\uDC00-\uDFFF]/u.test(text[start])) start--;
    if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end])) end++;
    return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function targetNames(entries: Iterable<[AttributeDefinition, AttributeValue]>): Record<string, string> {
    const pages = new Set<string>(), files = new Set<string>();
    for (const [def, value] of entries) {
        const kind = attributeTargetKind(def.type);
        if (!kind) continue;
        const ids = kind === "page" ? pages : files;
        for (const id of Array.isArray(value) ? value : [value]) if (typeof id === "string") ids.add(id);
    }
    const names: Record<string, string> = {};
    if (pages.size) {
        const rows = statement("SELECT p.id, knowledge_text(b.type,b.content) AS name FROM pages p JOIN blocks b ON b.id=p.title_block_id WHERE p.id IN (SELECT value FROM json_each(?))").all(JSON.stringify([...pages])) as { id: string; name: string }[];
        for (const row of rows) names[row.id] = row.name;
    }
    if (files.size) {
        const rows = statement("SELECT id, original_name AS name FROM attachments WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify([...files])) as { id: string; name: string }[];
        for (const row of rows) names[row.id] = row.name;
    }
    return names;
}

const libraryLocale = createI18n("zh-CN");
function orderedLibraryRows(query: LibraryQuery): { id: string; title: string }[] {
    const { column, direction } = query.sort, def = definition(column);
    const sortAttr = def && !def.hidden && column !== "modified_at";
    const parts = listFilter(query, sortAttr ? { column } : {});
    if (!parts) return [];
    const { from, filter, cte, params } = parts;
    const source = from + " JOIN blocks b ON b.id=p.title_block_id JOIN page_attrs m ON m.page_id=p.id AND m.attr_id='modified_at'" +
        (sortAttr ? " LEFT JOIN page_attrs s ON s.page_id=p.id AND s.attr_id=@column" : "") + filter;
    const valueColumn = sortAttr ? "s.value" : "m.value";
    if (column !== "title" && column !== "kind" && (!def || def.hidden || isTimeType(def.type) || def.type === "number")) {
        const order = valueColumn + (direction === "asc" ? " ASC" : " DESC") + " NULLS LAST" + (sortAttr ? ", m.value DESC" : "") + ", p.id";
        return statement(cte + "SELECT p.id,knowledge_text(b.type,b.content) AS title" + source + " ORDER BY " + order).all(...params) as { id: string; title: string }[];
    }
    const zone = resolveTimeZone(workspace.timeZone());
    const t: Translate = (key, options) => libraryLocale.t(key, { ...options, lng: query.language });
    const collator = new Intl.Collator(query.language === "zh-CN" ? "zh-CN-u-co-pinyin" : query.language, { numeric: true });
    const rows = statement(cte + "SELECT p.id, p.kind, knowledge_text(b.type,b.content) AS title, m.value AS modified, " + valueColumn + " AS value" + source).all(...params) as {
            id: string; kind: PageKind; title: string; modified: number; value: unknown; key?: string | null;
        }[];
    const kindLabels = Object.fromEntries(pageKinds.map(kind => [kind, t(`library.${kind}`)]));
    const decoded = new Map<unknown, AttributeValue>();
    if (sortAttr) for (const row of rows) {
        if (row.value != null && !decoded.has(row.value)) decoded.set(row.value, decodeValue(def, row.value));
    }
    const names = def && attributeTargetKind(def.type) ? targetNames(Array.from(decoded.values(), v => [def, v])) : {};
    const labels = new Map(Array.from(decoded, ([raw, value]) => [raw, libraryText(def!, value, query.language, zone, t, names)]));
    for (const row of rows) {
        if (column === "title") row.key = row.title || null;
        else if (column === "kind") row.key = kindLabels[row.kind];
        else row.key = labels.get(row.value) || null;
    }
    const sign = direction === "desc" ? -1 : 1;
    rows.sort((a, b) => {
        const x = a.key, y = b.key;
        if ((x == null) !== (y == null)) return x == null ? 1 : -1;
        const diff = x != null && y != null ? collator.compare(x, y) : 0;
        return sign * diff || b.modified - a.modified || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    return rows;
}

export function libraryIndex(query: LibraryQuery, initialColumns?: string[]): LibraryIndex & { initial?: PageSummary[] } {
    const rows = orderedLibraryRows(query);
    const filterLinks: [AttributeDefinition, AttributeValue][] = [];
    for (const [id, value] of Object.entries(query.attributes ?? {})) {
        const attr = definition(id);
        if (attr && attributeTargetKind(attr.type)) filterLinks.push([attr, value]);
    }
    const index = { ids: rows.map(row => row.id), titles: rows.map(row => row.title), ...(filterLinks.length ? { names: targetNames(filterLinks) } : {}) };
    if (!initialColumns || !index.ids.length) return index;
    // These IDs have already been filtered and ordered. Read just their headers for the first viewport.
    const heads = statement(`SELECT p.id,p.kind,p.title_block_id AS titleBlockId,p.children FROM json_each(?) j
        CROSS JOIN pages p ON p.id=j.value ORDER BY j.key`).all(JSON.stringify(index.ids.slice(0, libraryBatchSize))) as ListRow[];
    const initial = summaries(heads);
    return { ...index, initial, names: { ...index.names, ...summaryNames(initial, initialColumns) } };
}

function summaryNames(items: PageSummary[], columns?: string[]): Record<string, string> | undefined {
    const links = columns?.map(definition).filter(def => def && attributeTargetKind(def.type)) as AttributeDefinition[] | undefined;
    return links?.length ? targetNames(items.flatMap(row => links.map((def): [AttributeDefinition, AttributeValue] => [def, row.attributes[def.id]]))) : undefined;
}

export function overviewIndex(query: OverviewQuery): OverviewIndex {
    workspace.requireWorkspace();
    const status = definition(query.status), date = definition(query.date);
    const options = status?.type === "status" ? status.metadata.options?.filter(option => option.group === "incomplete").map(option => option.id) ?? [] : [];
    const hasDate = date?.type === "day";
    const order = hasDate ? { join: "LEFT JOIN page_attrs sort ON sort.page_id=s.page_id AND sort.attr_id=@date", sql: "sort.value ASC NULLS LAST" }
        : { join: "JOIN page_attrs sort ON sort.page_id=s.page_id AND sort.attr_id='modified_at'", sql: "sort.value DESC" };
    const taskIds = options.length ? statement(`SELECT s.page_id FROM page_attrs s
        JOIN page_attrs d ON d.page_id=s.page_id AND d.attr_id='deleted' AND d.value=0
        ${order.join}
        WHERE s.attr_id=@status AND s.value IN (SELECT value FROM json_each(@options))
        ORDER BY ${order.sql},s.page_id`).pluck().all({
        status: query.status, ...(hasDate ? { date: query.date } : {}), options: JSON.stringify(options)
    }) as string[] : [];
    const anchor = query.around ? taskIds.indexOf(query.around) : -1;
    const from = Math.max(0, anchor - Math.floor(overviewBatchSize / 3));
    return {
        taskIds, tasks: overviewRows(taskIds.slice(from, from + overviewBatchSize), hasDate ? query.date : undefined),
        recent: overviewRows(query.recent), missingStatus: status?.type !== "status"
    };
}

export function overviewRows(ids: string[], date?: string): OverviewPage[] {
    workspace.requireWorkspace();
    if (!ids.length) return [];
    const day = date && definition(date)?.type === "day" ? date : null;
    const rows = statement(`SELECT p.id,p.kind,knowledge_text(b.type,b.content) AS title,f.value AS pinned,day.value AS date
        FROM json_each(?) j CROSS JOIN pages p ON p.id=j.value CROSS JOIN blocks b ON p.title_block_id=b.id
        CROSS JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted' AND d.value=0
        LEFT JOIN page_attrs f ON f.page_id=p.id AND f.attr_id='pinned'
        LEFT JOIN page_attrs day ON day.page_id=p.id AND day.attr_id=? ORDER BY j.key`).all(JSON.stringify(ids), day) as OverviewPage[];
    return rows.map(row => ({ ...row, pinned: !!row.pinned }));
}

export function calendarRows(query: CalendarQuery): CalendarPage[] {
    workspace.requireWorkspace();
    if (!validTimeSeconds("day", query.from) || !validTimeSeconds("day", query.to) || query.from >= query.to || definition(query.date)?.type !== "day") return [];
    const start = query.start && definition(query.start)?.type === "minute" ? query.start : null;
    const status = query.status && definition(query.status)?.type === "status" ? query.status : null;
    // The initial scan starts at the indexed date range. Changes start at the affected page IDs.
    const range = query.ids ? "json_each(@ids) j CROSS JOIN page_attrs d ON d.page_id=j.value" : "page_attrs d INDEXED BY page_attrs_by_value";
    const result = statement(`SELECT p.id,knowledge_text(b.type,b.content) AS title,d.value AS date,
            s.value AS start,st.value AS status,st.page_id IS NOT NULL AS hasStatus,f.value AS pinned
        FROM ${range}
        CROSS JOIN pages p ON p.id=d.page_id
        CROSS JOIN blocks b ON b.id=p.title_block_id
        CROSS JOIN page_attrs r ON r.page_id=p.id AND r.attr_id='deleted' AND r.value=0
        LEFT JOIN page_attrs s ON s.page_id=p.id AND s.attr_id=@start
        LEFT JOIN page_attrs st ON st.page_id=p.id AND st.attr_id=@status
        LEFT JOIN page_attrs f ON f.page_id=p.id AND f.attr_id='pinned'
        WHERE d.attr_id=@date AND d.value>=@from AND d.value<@to AND typeof(d.value)='integer'`).all({
        date: query.date, from: query.from, to: query.to, start, status, ...(query.ids ? { ids: JSON.stringify(query.ids) } : {})
    }) as (Omit<CalendarPage, "hasStatus" | "pinned"> & { hasStatus: number; pinned: number | null })[];
    return result.map(page => ({ ...page, hasStatus: !!page.hasStatus, pinned: !!page.pinned }));
}

export function listUpdates(query: PageQuery, unchanged: string[], labelColumns?: string[]): PageList & { order: string[]; names?: Record<string, string> } {
    workspace.requireWorkspace();
    if (!Array.isArray(unchanged) || !unchanged.every(validUUID)) throw new LabloomError({ kind: "page-invalid-ids" });
    const { selected, total } = listRows(query), keep = new Set(unchanged);
    const items = summaries(selected.filter(row => !keep.has(row.id)));
    const names = summaryNames(items, labelColumns);
    return { order: selected.map(row => row.id), items, total, ...(names ? { names } : {}) };
}

export function resolve(target: Target): ResolvedTarget | null {
    workspace.requireWorkspace();
    if (!validTarget(target)) throw new LabloomError({ kind: "reference-invalid" });
    if (target.kind === "block") {
        const row = blockRow(target.id), block = row ? decodeBlock(row) : null, owned = owners(target.id);
        if (!block || !owned.length) return { status: "deleted", title: "", text: "" };
        const text = blockText(block);
        return { status: "ok", title: text, text, block, ownerId: owned.find(id => !flags(id).deleted) ?? owned[0] };
    }
    if (!statement("SELECT 1 FROM pages WHERE id=?").get(target.id)) return null;
    const page = get(target.id);
    return { title: page.title, text: page.excerpt, status: page.attributes.deleted ? "recycled" : "ok" };
}

export function backlinks(id: string): Backlink[] {
    workspace.requireWorkspace();
    header(id);
    const result = new Map<string, Backlink>();
    const hidden = new Set<string>();
    for (const edge of incoming({ kind: "page", id })) {
        const block = edge.sourceKind === "block";
        for (const owner of block ? owners(edge.sourceId) : [edge.sourceId]) {
            const before = result.get(owner);
            if (hidden.has(owner)) continue;
            if (!before && flags(owner).deleted) {
                hidden.add(owner);
                continue;
            }
            const fields = [...new Set([...(before?.sourceFields ?? []), ...block ? [] : [edge.sourceField]])];
            const anchor = before?.sourceBlockId ?? (block ? edge.sourceId : undefined);
            result.set(owner, { sourceId: owner, ...(anchor ? { sourceBlockId: anchor } : {}), pageKind: before?.pageKind ?? header(owner).kind, title: before?.title ?? title(owner, ""), sourceKind: block || before?.sourceKind === "reference" ? "reference" : "attribute", ...(fields.length ? { sourceFields: fields } : {}), deleted: false });
        }
    }
    return [...result.values()];
}