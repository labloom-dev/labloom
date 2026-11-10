import { desc, sql } from "drizzle-orm";
import { check, customType, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { type BlockKind } from "../../shared/types/Block";

// Runtime mappings of the persisted rows. Versioned SQL migrations also install
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
    index("page_attrs_by_value").on(table.attrId, table.value),
    index("page_attrs_order").on(table.attrId, desc(table.value), table.pageId)
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
    lastRefreshed: integer("last_refreshed"),
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
    publishedAt: integer("published_at"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false)
}, table => [
    unique().on(table.sourceId, table.externalId),
    index("feed_items_date").on(desc(table.publishedAt))
]);

// Only actual references enter this rebuildable index; shared block uses do not.
export const linkIndex = sqliteTable("link_index", {
    sourceKind: text("source_kind", { enum: ["page", "block"] }).notNull(),
    sourceId: text("source_id").notNull(),
    sourceField: text("source_field").notNull(),
    targetKind: text("target_kind", { enum: ["page", "block"] }).notNull(),
    targetId: text("target_id").notNull(),
    retains: integer("retains", { mode: "boolean" }).notNull().default(true)
}, table => [
    primaryKey({ columns: [table.sourceKind, table.sourceId, table.sourceField, table.targetKind, table.targetId] }),
    index("link_index_target").on(table.targetKind, table.targetId)
]);

export const editTabs = sqliteTable("edit_tabs", {
    id: text("id").primaryKey().notNull(),
    cursor: text("cursor")
});

export const undoNodes = sqliteTable("undo_nodes", {
    id: text("id").primaryKey().notNull(),
    tabId: text("tab_id").notNull().references(() => editTabs.id),
    parentId: text("parent_id"),
    pageId: text("page_id").notNull(),
    before: text("before_state", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    after: text("after_state", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("created_at").notNull()
}, table => [index("undo_nodes_tab").on(table.tabId), index("undo_nodes_parent").on(table.parentId)]);

export const undoObjects = sqliteTable("undo_objects", {
    nodeId: text("node_id").notNull().references(() => undoNodes.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull()
}, table => [
    primaryKey({ columns: [table.nodeId, table.objectKey] }),
    index("undo_objects_key").on(table.objectKey)
]);

export const attachments = sqliteTable("attachments", {
    id: text("id").primaryKey().notNull(),
    storedName: text("stored_name").notNull().unique(),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull()
});
export const pageAttachments = sqliteTable("page_attachments", {
    pageId: text("page_id").notNull().references(() => pages.id),
    fileId: text("file_id").notNull().references(() => attachments.id),
    role: text("role").notNull().default("fulltext"),
    position: integer("position").notNull()
}, table => [primaryKey({ columns: [table.pageId, table.fileId, table.role] })]);
export const anchors = sqliteTable("anchors", {
    id: text("id").primaryKey().notNull(),
    fileId: text("file_id").notNull().references(() => attachments.id),
    pageNumber: integer("page_number").notNull(),
    rectangles: text("rectangles", { mode: "json" }).$type<import("../../shared/types/papers").Rectangle[]>().notNull(),
    quote: text("quote").notNull(),
    context: text("context").notNull(),
    extractorVersion: text("extractor_version").notNull()
}, table => [index("anchors_file_page").on(table.fileId, table.pageNumber)]);
export const highlights = sqliteTable("highlights", {
    id: text("id").primaryKey().notNull(),
    anchorId: text("anchor_id").notNull().references(() => anchors.id),
    color: text("color").notNull()
});
// Configuration stays in page attributes. These are actual delivery attempts.
export const reminderSchedules = sqliteTable("reminder_schedules", {
    id: text("id").primaryKey().notNull(),
    pageId: text("page_id").notNull(),
    scheduledAt: integer("scheduled_at").notNull(),
    zone: text("zone").notNull(),
    state: text("state", { enum: ["pending", "fired", "disabled"] }).notNull()
}, table => [index("reminders_due").on(table.state, table.scheduledAt)]);
export const notifications = sqliteTable("notifications", {
    id: text("id").primaryKey().notNull(),
    scheduleId: text("schedule_id").notNull().unique(),
    pageId: text("page_id").notNull(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false)
});