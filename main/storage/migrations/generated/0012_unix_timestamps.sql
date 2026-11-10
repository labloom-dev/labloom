DROP TRIGGER IF EXISTS "page_registered_attrs_move";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_registered_attrs_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_registered_attrs_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_registered_attrs_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "registered_attrs_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "registered_attrs_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "registered_attrs_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_deleted_value_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_deleted_value_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_attrs_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_meta_modified";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_attrs_modified_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_attrs_modified_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_attrs_modified_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "attrs_modified_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "attrs_modified_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "attrs_modified_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_modified_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_modified_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_modified_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_modified_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_modified_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_modified_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_uses_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_uses_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_uses_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_uses_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_uses_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_uses_insert";
--> statement-breakpoint
CREATE TABLE `__new_feed_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`authors` text NOT NULL,
	`summary` text NOT NULL,
	`published_at` integer,
	`is_read` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_feed_items`("id", "source_id", "external_id", "title", "url", "authors", "summary", "published_at", "is_read") SELECT "id", "source_id", "external_id", "title", "url", "authors", "summary", CAST(round(unixepoch("published_at", 'subsec') * 1000) AS INTEGER), "is_read" FROM `feed_items`;
--> statement-breakpoint
DROP TABLE `feed_items`;
--> statement-breakpoint
ALTER TABLE `__new_feed_items` RENAME TO `feed_items`;
--> statement-breakpoint
CREATE INDEX `feed_items_date` ON `feed_items` ("published_at" desc);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_items_source_id_external_id_unique` ON `feed_items` (`source_id`,`external_id`);
--> statement-breakpoint
CREATE TABLE `__new_feed_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`last_refreshed` integer,
	`last_added` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
INSERT INTO `__new_feed_sources`("id", "name", "url", "last_refreshed", "last_added", "error") SELECT "id", "name", "url", CAST(round(unixepoch("last_refreshed", 'subsec') * 1000) AS INTEGER), "last_added", "error" FROM `feed_sources`;
--> statement-breakpoint
DROP TABLE `feed_sources`;
--> statement-breakpoint
ALTER TABLE `__new_feed_sources` RENAME TO `feed_sources`;
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_sources_url_unique` ON `feed_sources` (`url`);
--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`page_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`is_read` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "schedule_id", "page_id", "title", "created_at", "is_read") SELECT "id", "schedule_id", "page_id", "title", CAST(round(unixepoch("created_at", 'subsec') * 1000) AS INTEGER), "is_read" FROM `notifications`;
--> statement-breakpoint
DROP TABLE `notifications`;
--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_schedule_id_unique` ON `notifications` (`schedule_id`);
--> statement-breakpoint
CREATE TABLE `__new_reminder_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`zone` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_reminder_schedules`("id", "page_id", "scheduled_at", "zone", "state") SELECT "id", "page_id", unixepoch("scheduled_at"), "zone", "state" FROM `reminder_schedules`;
--> statement-breakpoint
DROP TABLE `reminder_schedules`;
--> statement-breakpoint
ALTER TABLE `__new_reminder_schedules` RENAME TO `reminder_schedules`;
--> statement-breakpoint
CREATE INDEX `reminders_due` ON `reminder_schedules` (`state`,`scheduled_at`);
--> statement-breakpoint
CREATE TABLE `__new_undo_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`tab_id` text NOT NULL,
	`parent_id` text,
	`page_id` text NOT NULL,
	`before_state` text NOT NULL,
	`after_state` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tab_id`) REFERENCES `edit_tabs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_undo_nodes`("id", "tab_id", "parent_id", "page_id", "before_state", "after_state", "created_at") SELECT "id", "tab_id", "parent_id", "page_id", "before_state", "after_state", CAST(round(unixepoch("created_at", 'subsec') * 1000) AS INTEGER) FROM `undo_nodes`;
--> statement-breakpoint
DROP TABLE `undo_nodes`;
--> statement-breakpoint
ALTER TABLE `__new_undo_nodes` RENAME TO `undo_nodes`;
--> statement-breakpoint
CREATE INDEX `undo_nodes_tab` ON `undo_nodes` (`tab_id`);
--> statement-breakpoint
CREATE INDEX `undo_nodes_parent` ON `undo_nodes` (`parent_id`);
--> statement-breakpoint
CREATE TABLE `__new_workspace_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_modified_at` integer NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "workspace_meta_settings_object" CHECK(json_valid("__new_workspace_meta"."settings") AND json_type("__new_workspace_meta"."settings") = 'object')
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_workspace_meta`("id", "name", "created_at", "last_modified_at", "settings") SELECT "id", "name", CAST(round(unixepoch("created_at", 'subsec') * 1000) AS INTEGER), CAST(round(unixepoch("last_modified_at", 'subsec') * 1000) AS INTEGER), "settings" FROM `workspace_meta`;
--> statement-breakpoint
DROP TABLE `workspace_meta`;
--> statement-breakpoint
ALTER TABLE `__new_workspace_meta` RENAME TO `workspace_meta`;
--> statement-breakpoint
UPDATE page_attrs SET value = unixepoch(value)
WHERE typeof(value) = 'text' AND attr_id IN (SELECT id FROM attrs WHERE type = 'datetime');
--> statement-breakpoint
DELETE FROM page_attrs WHERE attr_id IN ('task_status', 'priority')
AND page_id IN (SELECT id FROM pages WHERE kind = 'event');
--> statement-breakpoint
-- Versions before incremental edits stored complete pages with an attrs array.
-- Later nodes contain sparse values maps. Preserve absent rows, JSON nulls,
-- block content, the tree topology and both sides of every branch.
CREATE TEMP TABLE converted_undo_states AS
WITH states(node, side, state) AS (
    SELECT id, 'before', before_state FROM undo_nodes
    UNION ALL SELECT id, 'after', after_state FROM undo_nodes
), objects AS (
    SELECT s.node, s.side, obj.key, obj.value, p.kind
    FROM states s, json_each(s.state) obj
    LEFT JOIN pages p ON obj.key = 'page:' || p.id AND p.id = substr(obj.key, 6)
), converted AS (
    SELECT node, side, key, CASE
        WHEN key LIKE 'page:%' AND json_type(value, '$.values') = 'object' THEN
            json_set(value, '$.values', (
                SELECT json_group_object(v.key, json(CASE
                    WHEN a.type = 'datetime' AND json_type(v.value, '$.value') = 'text'
                    THEN json_set(v.value, '$.value', unixepoch(json_extract(v.value, '$.value')))
                    ELSE coalesce(v.value, 'null') END))
                FROM json_each(objects.value, '$.values') v LEFT JOIN attrs a ON a.id = v.key
                WHERE kind IS NOT 'event' OR v.key NOT IN ('task_status', 'priority')
            ))
        WHEN key LIKE 'page:%' AND json_type(value, '$.attrs') = 'array' THEN
            json_set(value, '$.attrs', (
                SELECT json_group_array(json(CASE
                    WHEN a.type = 'datetime' AND json_type(v.value, '$.value') = 'text'
                    THEN json_set(v.value, '$.value', unixepoch(json_extract(v.value, '$.value')))
                    ELSE v.value END) ORDER BY v.key)
                FROM json_each(objects.value, '$.attrs') v LEFT JOIN attrs a ON a.id = json_extract(v.value, '$.attrId')
                WHERE coalesce(json_extract(objects.value, '$.page.kind'), kind) IS NOT 'event'
                    OR json_extract(v.value, '$.attrId') NOT IN ('task_status', 'priority')
            ))
        ELSE coalesce(value, 'null') END AS object
    FROM objects
)
SELECT node, side, json_group_object(key, json(object)) AS state FROM converted GROUP BY node, side;
--> statement-breakpoint
CREATE UNIQUE INDEX converted_undo_key ON converted_undo_states(node, side);
--> statement-breakpoint
UPDATE undo_nodes SET
    before_state = coalesce((SELECT state FROM converted_undo_states WHERE node = undo_nodes.id AND side = 'before'), before_state),
    after_state = coalesce((SELECT state FROM converted_undo_states WHERE node = undo_nodes.id AND side = 'after'), after_state);
--> statement-breakpoint
DROP TABLE converted_undo_states;
--> statement-breakpoint
CREATE TRIGGER pages_uses_insert AFTER INSERT ON pages
            BEGIN

            SELECT RAISE(ABORT, 'children must contain block ID strings')
            WHERE EXISTS (SELECT 1 FROM json_each(NEW.children) WHERE type != 'text');


                INSERT INTO block_uses (container_kind, container_id, slot, position, block_id)
                VALUES ('page', NEW.id, 'title', 0, NEW.title_block_id);


            INSERT INTO block_uses (container_kind, container_id, slot, position, block_id)
            SELECT 'page', NEW.id, 'children', key, value FROM json_each(NEW.children);

            END;
--> statement-breakpoint
CREATE TRIGGER pages_uses_update AFTER UPDATE OF id, title_block_id, children ON pages
            WHEN NEW.id IS NOT OLD.id OR NEW.title_block_id IS NOT OLD.title_block_id OR NEW.children IS NOT OLD.children
            BEGIN
                DELETE FROM block_uses WHERE container_kind = 'page' AND container_id = OLD.id;

            SELECT RAISE(ABORT, 'children must contain block ID strings')
            WHERE EXISTS (SELECT 1 FROM json_each(NEW.children) WHERE type != 'text');


                INSERT INTO block_uses (container_kind, container_id, slot, position, block_id)
                VALUES ('page', NEW.id, 'title', 0, NEW.title_block_id);


            INSERT INTO block_uses (container_kind, container_id, slot, position, block_id)
            SELECT 'page', NEW.id, 'children', key, value FROM json_each(NEW.children);

            END;
--> statement-breakpoint
CREATE TRIGGER pages_uses_delete AFTER DELETE ON pages
            BEGIN
                DELETE FROM block_uses WHERE container_kind = 'page' AND container_id = OLD.id;
            END;
--> statement-breakpoint
CREATE TRIGGER blocks_uses_insert AFTER INSERT ON blocks
            BEGIN

            SELECT RAISE(ABORT, 'children must contain block ID strings')
            WHERE EXISTS (SELECT 1 FROM json_each(NEW.children) WHERE type != 'text');



            INSERT INTO block_uses (container_kind, container_id, slot, position, block_id)
            SELECT 'block', NEW.id, 'children', key, value FROM json_each(NEW.children);

            END;
--> statement-breakpoint
CREATE TRIGGER blocks_uses_update AFTER UPDATE OF id, children ON blocks
            WHEN NEW.id IS NOT OLD.id OR NEW.children IS NOT OLD.children
            BEGIN
                DELETE FROM block_uses WHERE container_kind = 'block' AND container_id = OLD.id;

            SELECT RAISE(ABORT, 'children must contain block ID strings')
            WHERE EXISTS (SELECT 1 FROM json_each(NEW.children) WHERE type != 'text');



            INSERT INTO block_uses (container_kind, container_id, slot, position, block_id)
            SELECT 'block', NEW.id, 'children', key, value FROM json_each(NEW.children);

            END;
--> statement-breakpoint
CREATE TRIGGER blocks_uses_delete AFTER DELETE ON blocks
            BEGIN
                DELETE FROM block_uses WHERE container_kind = 'block' AND container_id = OLD.id;
            END;
--> statement-breakpoint
CREATE TRIGGER pages_modified_insert AFTER INSERT ON pages

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER pages_modified_update AFTER UPDATE ON pages
                WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.title_block_id IS NOT OLD.title_block_id OR NEW.children IS NOT OLD.children
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER pages_modified_delete AFTER DELETE ON pages

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER blocks_modified_insert AFTER INSERT ON blocks

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER blocks_modified_update AFTER UPDATE ON blocks
                WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.content IS NOT OLD.content OR NEW.children IS NOT OLD.children
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER blocks_modified_delete AFTER DELETE ON blocks

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER attrs_modified_insert AFTER INSERT ON attrs

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER attrs_modified_update AFTER UPDATE ON attrs
                WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.metadata IS NOT OLD.metadata
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER attrs_modified_delete AFTER DELETE ON attrs

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER page_attrs_modified_insert AFTER INSERT ON page_attrs

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER page_attrs_modified_update AFTER UPDATE ON page_attrs
                WHEN NEW.page_id IS NOT OLD.page_id OR NEW.attr_id IS NOT OLD.attr_id OR NEW.value IS NOT OLD.value
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER page_attrs_modified_delete AFTER DELETE ON page_attrs

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER workspace_meta_modified AFTER UPDATE OF name, settings ON workspace_meta
        WHEN NEW.name IS NOT OLD.name OR NEW.settings IS NOT OLD.settings
        BEGIN
            UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
        END;
--> statement-breakpoint
CREATE TRIGGER pages_attrs_delete AFTER DELETE ON pages
            BEGIN
                DELETE FROM page_attrs WHERE page_id = OLD.id;
            END;
--> statement-breakpoint
CREATE TRIGGER page_deleted_value_insert BEFORE INSERT ON page_attrs
                WHEN NEW.attr_id = 'deleted' AND NEW.value IS NOT NULL
                    AND NOT (typeof(NEW.value) IN ('integer', 'real') AND NEW.value IN (0, 1))
                BEGIN
                    SELECT RAISE(ABORT, 'The Labloom deleted attribute value must be NULL, 0, or 1.');
                END;
--> statement-breakpoint
CREATE TRIGGER page_deleted_value_update BEFORE UPDATE ON page_attrs
                WHEN NEW.attr_id = 'deleted' AND NEW.value IS NOT NULL
                    AND NOT (typeof(NEW.value) IN ('integer', 'real') AND NEW.value IN (0, 1))
                BEGIN
                    SELECT RAISE(ABORT, 'The Labloom deleted attribute value must be NULL, 0, or 1.');
                END;
--> statement-breakpoint
CREATE TRIGGER registered_attrs_delete BEFORE DELETE ON attrs WHEN OLD.id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'paper_authors', 'paper_doi', 'paper_year', 'paper_venue', 'paper_url', 'paper_abstract', 'paper_keywords', 'source_snapshot', 'reading_position', 'annotation_paper', 'annotation_anchor', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at') BEGIN SELECT RAISE(ABORT, 'Labloom builtin attributes cannot be deleted.'); END;
--> statement-breakpoint
CREATE TRIGGER registered_attrs_update BEFORE UPDATE OF id, type ON attrs WHEN (OLD.id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'paper_authors', 'paper_doi', 'paper_year', 'paper_venue', 'paper_url', 'paper_abstract', 'paper_keywords', 'source_snapshot', 'reading_position', 'annotation_paper', 'annotation_anchor', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at') AND (NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type)) OR (NEW.id = 'deleted' AND NEW.type != 'boolean') OR (NEW.id = 'independent' AND NEW.type != 'boolean') OR (NEW.id = 'created_at' AND NEW.type != 'datetime') OR (NEW.id = 'modified_at' AND NEW.type != 'datetime') OR (NEW.id = 'recycle_reason' AND NEW.type != 'select') OR (NEW.id = 'recycled_at' AND NEW.type != 'datetime') OR (NEW.id = 'pinned' AND NEW.type != 'boolean') OR (NEW.id = 'tags' AND NEW.type != 'multiselect') OR (NEW.id = 'links' AND NEW.type != 'page-links') OR (NEW.id = 'paper_authors' AND NEW.type != 'string') OR (NEW.id = 'paper_doi' AND NEW.type != 'string') OR (NEW.id = 'paper_year' AND NEW.type != 'string') OR (NEW.id = 'paper_venue' AND NEW.type != 'string') OR (NEW.id = 'paper_url' AND NEW.type != 'url') OR (NEW.id = 'paper_abstract' AND NEW.type != 'string') OR (NEW.id = 'paper_keywords' AND NEW.type != 'string') OR (NEW.id = 'source_snapshot' AND NEW.type != 'json') OR (NEW.id = 'reading_position' AND NEW.type != 'json') OR (NEW.id = 'annotation_paper' AND NEW.type != 'page-link') OR (NEW.id = 'annotation_anchor' AND NEW.type != 'string') OR (NEW.id = 'task_status' AND NEW.type != 'select') OR (NEW.id = 'priority' AND NEW.type != 'select') OR (NEW.id = 'schedule_date' AND NEW.type != 'date') OR (NEW.id = 'schedule_start' AND NEW.type != 'datetime') OR (NEW.id = 'schedule_end' AND NEW.type != 'datetime') OR (NEW.id = 'schedule_zone' AND NEW.type != 'string') OR (NEW.id = 'reminder_at' AND NEW.type != 'datetime') BEGIN SELECT RAISE(ABORT, 'The ID and type of a Labloom builtin attribute cannot be changed.'); END;
--> statement-breakpoint
CREATE TRIGGER registered_attrs_insert BEFORE INSERT ON attrs WHEN (NEW.id = 'deleted' AND NEW.type != 'boolean') OR (NEW.id = 'independent' AND NEW.type != 'boolean') OR (NEW.id = 'created_at' AND NEW.type != 'datetime') OR (NEW.id = 'modified_at' AND NEW.type != 'datetime') OR (NEW.id = 'recycle_reason' AND NEW.type != 'select') OR (NEW.id = 'recycled_at' AND NEW.type != 'datetime') OR (NEW.id = 'pinned' AND NEW.type != 'boolean') OR (NEW.id = 'tags' AND NEW.type != 'multiselect') OR (NEW.id = 'links' AND NEW.type != 'page-links') OR (NEW.id = 'paper_authors' AND NEW.type != 'string') OR (NEW.id = 'paper_doi' AND NEW.type != 'string') OR (NEW.id = 'paper_year' AND NEW.type != 'string') OR (NEW.id = 'paper_venue' AND NEW.type != 'string') OR (NEW.id = 'paper_url' AND NEW.type != 'url') OR (NEW.id = 'paper_abstract' AND NEW.type != 'string') OR (NEW.id = 'paper_keywords' AND NEW.type != 'string') OR (NEW.id = 'source_snapshot' AND NEW.type != 'json') OR (NEW.id = 'reading_position' AND NEW.type != 'json') OR (NEW.id = 'annotation_paper' AND NEW.type != 'page-link') OR (NEW.id = 'annotation_anchor' AND NEW.type != 'string') OR (NEW.id = 'task_status' AND NEW.type != 'select') OR (NEW.id = 'priority' AND NEW.type != 'select') OR (NEW.id = 'schedule_date' AND NEW.type != 'date') OR (NEW.id = 'schedule_start' AND NEW.type != 'datetime') OR (NEW.id = 'schedule_end' AND NEW.type != 'datetime') OR (NEW.id = 'schedule_zone' AND NEW.type != 'string') OR (NEW.id = 'reminder_at' AND NEW.type != 'datetime') BEGIN SELECT RAISE(ABORT, 'The Labloom deleted attribute must have type boolean.') WHERE NEW.id = 'deleted'; SELECT RAISE(ABORT, 'The Labloom builtin attribute has an incompatible type.'); END;
--> statement-breakpoint
CREATE TRIGGER pages_registered_attrs_insert AFTER INSERT ON pages WHEN NEW.kind IN ('editable', 'paper', 'annotation', 'task', 'event') BEGIN
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_authors', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_doi', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_year', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_venue', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_url', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_abstract', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_keywords', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'source_snapshot', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'reading_position', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'annotation_paper', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'annotation_anchor', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'task_status', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'priority', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_date', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_start', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_end', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_zone', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'reminder_at', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_date', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_start', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_end', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_zone', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'reminder_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER pages_registered_attrs_update AFTER UPDATE OF kind ON pages WHEN NEW.kind IS NOT OLD.kind AND NEW.kind IN ('editable', 'paper', 'annotation', 'task', 'event') BEGIN
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_authors', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_doi', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_year', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_venue', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_url', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_abstract', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'paper_keywords', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'source_snapshot', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'reading_position', NULL WHERE NEW.kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'annotation_paper', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'annotation_anchor', NULL WHERE NEW.kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'task_status', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'priority', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_date', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_start', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_end', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_zone', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'reminder_at', NULL WHERE NEW.kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'deleted', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_date', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_start', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_end', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_zone', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'reminder_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER page_registered_attrs_delete BEFORE DELETE ON page_attrs WHEN EXISTS (SELECT 1 FROM pages WHERE id = OLD.page_id AND ((kind = 'editable' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links')) OR (kind = 'paper' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'paper_authors', 'paper_doi', 'paper_year', 'paper_venue', 'paper_url', 'paper_abstract', 'paper_keywords', 'source_snapshot', 'reading_position')) OR (kind = 'annotation' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'annotation_paper', 'annotation_anchor')) OR (kind = 'task' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at')) OR (kind = 'event' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at')))) BEGIN SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.'); END;
--> statement-breakpoint
CREATE TRIGGER page_registered_attrs_move BEFORE UPDATE OF page_id, attr_id ON page_attrs WHEN (NEW.page_id IS NOT OLD.page_id OR NEW.attr_id IS NOT OLD.attr_id) AND EXISTS (SELECT 1 FROM pages WHERE id = OLD.page_id AND ((kind = 'editable' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links')) OR (kind = 'paper' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'paper_authors', 'paper_doi', 'paper_year', 'paper_venue', 'paper_url', 'paper_abstract', 'paper_keywords', 'source_snapshot', 'reading_position')) OR (kind = 'annotation' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'annotation_paper', 'annotation_anchor')) OR (kind = 'task' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at')) OR (kind = 'event' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at')))) BEGIN SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.'); END;