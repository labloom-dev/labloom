import { desc, sql } from "drizzle-orm";
import { check, customType, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { type BlockKind } from "../../shared/types/Block";

// Runtime mappings of the persisted rows. Versioned SQL migrations also install
// STRICT table options and triggers; business/IPC models remain independent.
export const workspaceMeta = sqliteTable("workspace_meta", {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    lastModifiedAt: text("last_modified_at").notNull(),
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

export const attrs = sqliteTable("attrs", {
    id: text("id").primaryKey().notNull(),
    type: text("type").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({})
}, table => [
    check("attrs_metadata_object", sql`json_valid(${table.metadata}) AND json_type(${table.metadata}) = 'object'`)
]);

// SQLite STRICT ANY preserves storage types, including numeric-looking strings.
// Attribute-specific boolean/JSON conversion belongs at the business boundary.
const anyValue = customType<{ data: string | number | Buffer; }>({
    dataType: () => "ANY"
});

export const pageAttrs = sqliteTable("page_attrs", {
    pageId: text("page_id").notNull().references(() => pages.id),
    attrId: text("attr_id").notNull().references(() => attrs.id),
    value: anyValue("value").default(sql`NULL`)
}, table => [
    primaryKey({ columns: [table.pageId, table.attrId] }),
    index("page_attrs_by_value").on(table.attrId, table.value)
]);

export const blockUses = sqliteTable("block_uses", {
    containerKind: text("container_kind", { enum: ["page", "block"] }).notNull(),
    containerId: text("container_id").notNull(),
    slot: text("slot", { enum: ["title", "children"] }).notNull(),
    position: integer("position").notNull(),
    // Missing targets are retained so a broken reference can still be displayed.
    blockId: text("block_id").notNull()
}, table => [
    primaryKey({ columns: [table.containerKind, table.containerId, table.slot, table.position] }),
    index("block_uses_by_block").on(table.blockId),
    check("block_uses_container_kind", sql`${table.containerKind} IN ('page', 'block')`),
    check("block_uses_slot", sql`${table.slot} IN ('title', 'children')`),
    check("block_uses_position", sql`${table.position} >= 0`),
    check("block_uses_title", sql`${table.slot} != 'title' OR (${table.containerKind} = 'page' AND ${table.position} = 0)`)
]);

export const feedSources = sqliteTable("feed_sources", {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    url: text("url").notNull().unique(),
    lastRefreshed: text("last_refreshed"),
    lastAdded: integer("last_added").notNull().default(0),
    error: text("error")
});

export const feedItems = sqliteTable("feed_items", {
    id: text("id").primaryKey().notNull(),
    sourceId: text("source_id").notNull().references(() => feedSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    authors: text("authors").notNull(),
    summary: text("summary").notNull(),
    publishedAt: text("published_at"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false)
}, table => [
    unique().on(table.sourceId, table.externalId),
    index("feed_items_date").on(desc(table.publishedAt))
]);