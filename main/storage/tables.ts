import { desc, sql } from "drizzle-orm";
import { check, customType, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { type BlockKind } from "../../shared/types/Block";

// Runtime mappings of the persisted rows. The generated SQL baseline also installs
// STRICT table options and triggers; business/IPC models remain independent.
export const workspaceMeta = sqliteTable("workspace_meta", {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    lastModifiedAt: integer("last_modified_at").notNull(),
    settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({})
}, table => [
    check("workspace_meta_settings_object", sql`json_valid(${table.settings}) AND json_type(${table.settings}) = 'object'`)
]);

export const blocks = sqliteTable("blocks", {
    id: text("id").primaryKey().notNull(),
    type: text("type").$type<BlockKind>().notNull(),
    content: text("content"),
    children: text("children", { mode: "json" }).$type<string[]>().notNull().default([])
}, table => [
    check("blocks_children_array", sql`json_valid(${table.children}) AND json_type(${table.children}) = 'array'`)
]);

export const pages = sqliteTable("pages", {
    id: text("id").primaryKey().notNull(),
    kind: text("kind").notNull(),
    titleBlockId: text("title_block_id").notNull().references(() => blocks.id),
    children: text("children", { mode: "json" }).$type<string[]>().notNull().default([])
}, table => [
    check("pages_children_array", sql`json_valid(${table.children}) AND json_type(${table.children}) = 'array'`)
]);

export const attrsMeta = sqliteTable("attrs_meta", {
    id: text("id").primaryKey().notNull(),
    type: text("type").notNull(),
    name: text("name"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({})
}, table => [
    check("attrs_meta_metadata_object", sql`json_valid(${table.metadata}) AND json_type(${table.metadata}) = 'object'`)
]);

// SQLite STRICT ANY preserves storage types, including numeric-looking strings.
// Attribute-specific boolean/JSON conversion belongs at the business boundary.
const anyValue = customType<{ data: string | number | Buffer; }>({
    dataType: () => "ANY"
});

export const pageAttrs = sqliteTable("page_attrs", {
    pageId: text("page_id").notNull().references(() => pages.id),
    attrId: text("attr_id").notNull().references(() => attrsMeta.id),
    value: anyValue("value").default(sql`NULL`)
}, table => [
    primaryKey({ columns: [table.pageId, table.attrId] }),
    index("page_attrs_by_value").on(table.attrId, table.value),
    index("page_attrs_order").on(table.attrId, desc(table.value), table.pageId)
]);

export const syncRefs = sqliteTable("sync_refs", {
    containerKind: text("container_kind", { enum: ["page", "block"] }).notNull(),
    containerId: text("container_id").notNull(),
    slot: text("slot", { enum: ["title", "children"] }).notNull(),
    position: integer("position").notNull(),
    // Missing targets are retained so a broken reference can still be displayed.
    blockId: text("block_id").notNull()
}, table => [
    primaryKey({ columns: [table.containerKind, table.containerId, table.slot, table.position] }),
    index("sync_refs_by_block").on(table.blockId),
    check("sync_refs_container_kind", sql`${table.containerKind} IN ('page', 'block')`),
    check("sync_refs_slot", sql`${table.slot} IN ('title', 'children')`),
    check("sync_refs_position", sql`${table.position} >= 0`),
    check("sync_refs_title", sql`${table.slot} != 'title' OR (${table.containerKind} = 'page' AND ${table.position} = 0)`)
]);

export const feedItems = sqliteTable("feed_items", {
    id: text("id").primaryKey().notNull(),
    // Cancelling retains items; permanent deletion of the source page removes them.
    sourceId: text("source_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    title: text("title").notNull(),
    url: text("url"),
    normalizedUrl: text("normalized_url"),
    fingerprint: text("content_fingerprint"),
    authors: text("authors").notNull(),
    summary: text("summary").notNull(),
    // Source markup as received; it is sanitized when displayed.
    content: text("raw_content").notNull().default(""),
    // False when the source only offered a summary for this item.
    fullContent: integer("has_full_content", { mode: "boolean" }).notNull().default(false),
    publishedAt: integer("published_at"),
    originSnapshot: text("origin_snapshot", { mode: "json" }).$type<import("../../shared/types/feed").FeedOrigin>(),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    readingPosition: text("reading_position", { mode: "json" }).$type<import("../../shared/types/feed").FeedPosition>(),
    paperId: text("paper_id"),
    pdfURL: text("pdf_url")
}, table => [
    unique().on(table.sourceId, table.externalId),
    index("feed_items_date").on(desc(table.publishedAt)),
    index("feed_items_url").on(table.sourceId, table.normalizedUrl),
    index("feed_items_fingerprint").on(table.sourceId, table.fingerprint),
    index("feed_items_paper").on(table.paperId)
]);

// Only actual references enter this rebuildable index; shared block uses do not.
export const linkRefs = sqliteTable("link_refs", {
    sourceKind: text("source_kind", { enum: ["page", "block"] }).notNull(),
    sourceId: text("source_id").notNull(),
    sourceField: text("source_field").notNull(),
    targetKind: text("target_kind", { enum: ["page", "block", "file"] }).notNull(),
    targetId: text("target_id").notNull()
}, table => [
    primaryKey({ columns: [table.sourceKind, table.sourceId, table.sourceField, table.targetKind, table.targetId] }),
    index("link_refs_target").on(table.targetKind, table.targetId)
]);

export const attachments = sqliteTable("attachments", {
    id: text("id").primaryKey().notNull(),
    storedName: text("stored_name").notNull().unique(),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    size: integer("size").notNull()
});
export const timers = sqliteTable("timers", {
    pageId: text("page_id").notNull(),
    attrId: text("attr_id").notNull(),
    leadSeconds: integer("lead_seconds").notNull().default(0),
    dueAt: integer("due_at"),
    firedAt: integer("fired_at"),
    seen: integer("seen", { mode: "boolean" }).notNull().default(false)
}, table => [
    primaryKey({ columns: [table.pageId, table.attrId, table.leadSeconds] }),
    foreignKey({ columns: [table.pageId, table.attrId], foreignColumns: [pageAttrs.pageId, pageAttrs.attrId] }).onDelete("cascade"),
    index("timers_due").on(table.dueAt),
    check("timers_lead_seconds", sql`${table.leadSeconds} >= 0`),
    check("timers_seen", sql`${table.seen} IN (0, 1)`)
]);