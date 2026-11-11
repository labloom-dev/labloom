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
DROP TRIGGER IF EXISTS "page_attr_value_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_attr_value_insert";
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
	`external_id` text,
	`title` text NOT NULL,
	`url` text,
	`normalized_url` text,
	`content_fingerprint` text,
	`authors` text NOT NULL,
	`summary` text NOT NULL,
	`raw_content` text DEFAULT '' NOT NULL,
	`has_full_content` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`origin_snapshot` text,
	`is_read` integer DEFAULT false NOT NULL,
	`reading_position` text,
	`paper_id` text,
	FOREIGN KEY (`source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_feed_items`("id", "source_id", "external_id", "title", "url", "authors", "summary", "published_at", "is_read") SELECT "id", "source_id", "external_id", "title", "url", "authors", "summary", "published_at", "is_read" FROM `feed_items`;
--> statement-breakpoint
DROP TABLE `feed_items`;
--> statement-breakpoint
ALTER TABLE `__new_feed_items` RENAME TO `feed_items`;
--> statement-breakpoint
CREATE INDEX `feed_items_date` ON `feed_items` ("published_at" desc);
--> statement-breakpoint
CREATE INDEX `feed_items_url` ON `feed_items` (`source_id`,`normalized_url`);
--> statement-breakpoint
CREATE INDEX `feed_items_fingerprint` ON `feed_items` (`source_id`,`content_fingerprint`);
--> statement-breakpoint
CREATE INDEX `feed_items_paper` ON `feed_items` (`paper_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_items_source_id_external_id_unique` ON `feed_items` (`source_id`,`external_id`);
--> statement-breakpoint
CREATE TABLE `__new_feed_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`subscription_status` text DEFAULT 'enabled' NOT NULL,
	`auto_refresh` integer DEFAULT true NOT NULL,
	`interval_minutes` integer DEFAULT 60 NOT NULL,
	`last_refreshed` integer,
	`last_added` integer DEFAULT 0 NOT NULL,
	`error` text,
	`last_checked` integer,
	`next_refresh` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	`etag` text,
	`last_modified` text,
	CONSTRAINT "feed_sources_status" CHECK("__new_feed_sources"."subscription_status" IN ('enabled', 'paused', 'cancelled')),
	CONSTRAINT "feed_sources_interval" CHECK("__new_feed_sources"."interval_minutes" BETWEEN 15 AND 1440)
);
--> statement-breakpoint
INSERT INTO `__new_feed_sources`("id", "name", "url", "last_refreshed", "last_added", "error", "last_checked") SELECT "id", "name", "url", "last_refreshed", "last_added", "error", "last_refreshed" FROM `feed_sources`;
--> statement-breakpoint
DROP TABLE `feed_sources`;
--> statement-breakpoint
ALTER TABLE `__new_feed_sources` RENAME TO `feed_sources`;
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_sources_url_unique` ON `feed_sources` (`url`);
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
CREATE TRIGGER page_attr_value_insert BEFORE INSERT ON page_attrs BEGIN
    SELECT RAISE(ABORT, 'A boolean attribute value must be 0 or 1.')
    WHERE (SELECT type FROM attrs WHERE id = NEW.attr_id) = 'boolean'
      AND NOT (typeof(NEW.value) IN ('integer', 'real') AND NEW.value IN (0, 1));
    SELECT RAISE(ABORT, 'Invalid NULL for this attribute type.')
    WHERE NEW.value IS NULL AND EXISTS (
        SELECT 1 FROM attrs a JOIN attribute_defaults d ON d.type = a.type
        WHERE a.id = NEW.attr_id AND d.value IS NOT NULL
    );
END;
--> statement-breakpoint
CREATE TRIGGER page_attr_value_update BEFORE UPDATE OF attr_id, value ON page_attrs BEGIN
    SELECT RAISE(ABORT, 'A boolean attribute value must be 0 or 1.')
    WHERE (SELECT type FROM attrs WHERE id = NEW.attr_id) = 'boolean'
      AND NOT (typeof(NEW.value) IN ('integer', 'real') AND NEW.value IN (0, 1));
    SELECT RAISE(ABORT, 'Invalid NULL for this attribute type.')
    WHERE NEW.value IS NULL AND EXISTS (
        SELECT 1 FROM attrs a JOIN attribute_defaults d ON d.type = a.type
        WHERE a.id = NEW.attr_id AND d.value IS NOT NULL
    );
END;
--> statement-breakpoint
CREATE TRIGGER registered_attrs_delete BEFORE DELETE ON attrs
WHEN EXISTS (SELECT 1 FROM builtin_page_attrs WHERE attr_id = OLD.id)
BEGIN
    SELECT RAISE(ABORT, 'Labloom builtin attributes cannot be deleted.');
END;
--> statement-breakpoint
CREATE TRIGGER registered_attrs_update BEFORE UPDATE OF id, type ON attrs
WHEN ((NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type) AND EXISTS (SELECT 1 FROM builtin_page_attrs WHERE attr_id = OLD.id))
  OR EXISTS (SELECT 1 FROM builtin_page_attrs WHERE attr_id = NEW.id AND type != NEW.type)
BEGIN
    SELECT RAISE(ABORT, 'The ID and type of a Labloom builtin attribute cannot be changed.');
END;
--> statement-breakpoint
CREATE TRIGGER registered_attrs_insert BEFORE INSERT ON attrs
WHEN EXISTS (SELECT 1 FROM builtin_page_attrs WHERE attr_id = NEW.id AND type != NEW.type)
BEGIN
    SELECT RAISE(ABORT, 'The Labloom deleted attribute must have type boolean.') WHERE NEW.id = 'deleted';
    SELECT RAISE(ABORT, 'The Labloom builtin attribute has an incompatible type.');
END;
--> statement-breakpoint
CREATE TRIGGER pages_registered_attrs_insert AFTER INSERT ON pages BEGIN
    INSERT INTO page_attrs (page_id, attr_id, value)
    SELECT NEW.id, b.attr_id, d.value FROM builtin_page_attrs b
    JOIN attribute_defaults d ON d.type = b.type WHERE b.kind = NEW.kind
    ON CONFLICT (page_id, attr_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER pages_registered_attrs_update AFTER UPDATE OF kind ON pages WHEN NEW.kind IS NOT OLD.kind BEGIN
    INSERT INTO page_attrs (page_id, attr_id, value)
    SELECT NEW.id, b.attr_id, d.value FROM builtin_page_attrs b
    JOIN attribute_defaults d ON d.type = b.type WHERE b.kind = NEW.kind
    ON CONFLICT (page_id, attr_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER page_registered_attrs_delete BEFORE DELETE ON page_attrs
WHEN EXISTS (SELECT 1 FROM pages p JOIN builtin_page_attrs b ON b.kind = p.kind
             WHERE p.id = OLD.page_id AND b.attr_id = OLD.attr_id)
BEGIN
    SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.');
END;
--> statement-breakpoint
CREATE TRIGGER page_registered_attrs_move BEFORE UPDATE OF page_id, attr_id ON page_attrs
WHEN (NEW.page_id IS NOT OLD.page_id OR NEW.attr_id IS NOT OLD.attr_id)
 AND EXISTS (SELECT 1 FROM pages p JOIN builtin_page_attrs b ON b.kind = p.kind
             WHERE p.id = OLD.page_id AND b.attr_id = OLD.attr_id)
BEGIN
    SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.');
END;