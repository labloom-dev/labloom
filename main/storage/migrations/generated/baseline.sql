CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`stored_name` text NOT NULL,
	`original_name` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_stored_name_unique` ON `attachments` (`stored_name`);
--> statement-breakpoint
CREATE TABLE `attrs_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "attrs_meta_metadata_object" CHECK(json_valid("attrs_meta"."metadata") AND json_type("attrs_meta"."metadata") = 'object')
) STRICT;
--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`content` text,
	`children` text DEFAULT '[]' NOT NULL,
	CONSTRAINT "blocks_children_array" CHECK(json_valid("blocks"."children") AND json_type("blocks"."children") = 'array')
) STRICT;
--> statement-breakpoint
CREATE TABLE `feed_items` (
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
	`pdf_url` text,
	FOREIGN KEY (`source_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
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
CREATE TABLE `link_refs` (
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_field` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	PRIMARY KEY(`source_kind`, `source_id`, `source_field`, `target_kind`, `target_id`)
);
--> statement-breakpoint
CREATE INDEX `link_refs_target` ON `link_refs` (`target_kind`,`target_id`);
--> statement-breakpoint
CREATE TABLE `page_attrs` (
	`page_id` text NOT NULL,
	`attr_id` text NOT NULL,
	`value` ANY DEFAULT NULL,
	PRIMARY KEY(`page_id`, `attr_id`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attr_id`) REFERENCES `attrs_meta`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `page_attrs_by_value` ON `page_attrs` (`attr_id`,`value`);
--> statement-breakpoint
CREATE INDEX `page_attrs_order` ON `page_attrs` (`attr_id`,"value" desc,`page_id`);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title_block_id` text NOT NULL,
	`children` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`title_block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pages_children_array" CHECK(json_valid("pages"."children") AND json_type("pages"."children") = 'array')
) STRICT;
--> statement-breakpoint
CREATE TABLE `sync_refs` (
	`container_kind` text NOT NULL,
	`container_id` text NOT NULL,
	`slot` text NOT NULL,
	`position` integer NOT NULL,
	`block_id` text NOT NULL,
	PRIMARY KEY(`container_kind`, `container_id`, `slot`, `position`),
	CONSTRAINT "sync_refs_container_kind" CHECK("sync_refs"."container_kind" IN ('page', 'block')),
	CONSTRAINT "sync_refs_slot" CHECK("sync_refs"."slot" IN ('title', 'children')),
	CONSTRAINT "sync_refs_position" CHECK("sync_refs"."position" >= 0),
	CONSTRAINT "sync_refs_title" CHECK("sync_refs"."slot" != 'title' OR ("sync_refs"."container_kind" = 'page' AND "sync_refs"."position" = 0))
) STRICT;
--> statement-breakpoint
CREATE INDEX `sync_refs_by_block` ON `sync_refs` (`block_id`);
--> statement-breakpoint
CREATE TABLE `timers` (
	`page_id` text NOT NULL,
	`attr_id` text NOT NULL,
	`lead_seconds` integer DEFAULT 0 NOT NULL,
	`due_at` integer,
	`fired_at` integer,
	`seen` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`page_id`, `attr_id`, `lead_seconds`),
	FOREIGN KEY (`page_id`,`attr_id`) REFERENCES `page_attrs`(`page_id`,`attr_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "timers_lead_seconds" CHECK("timers"."lead_seconds" >= 0),
	CONSTRAINT "timers_seen" CHECK("timers"."seen" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `timers_due` ON `timers` (`due_at`);
--> statement-breakpoint
CREATE TABLE `workspace_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_modified_at` integer NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "workspace_meta_settings_object" CHECK(json_valid("workspace_meta"."settings") AND json_type("workspace_meta"."settings") = 'object')
) STRICT;
--> statement-breakpoint
CREATE TRIGGER pages_uses_insert AFTER INSERT ON pages
            BEGIN

            SELECT RAISE(ABORT, 'children must contain block ID strings')
            WHERE EXISTS (SELECT 1 FROM json_each(NEW.children) WHERE type != 'text');


                INSERT INTO sync_refs (container_kind, container_id, slot, position, block_id)
                VALUES ('page', NEW.id, 'title', 0, NEW.title_block_id);


            INSERT INTO sync_refs (container_kind, container_id, slot, position, block_id)
            SELECT 'page', NEW.id, 'children', key, value FROM json_each(NEW.children);

            END;
--> statement-breakpoint
CREATE TRIGGER pages_uses_update AFTER UPDATE OF id, title_block_id, children ON pages
            WHEN NEW.id IS NOT OLD.id OR NEW.title_block_id IS NOT OLD.title_block_id OR NEW.children IS NOT OLD.children
            BEGIN
                DELETE FROM sync_refs WHERE container_kind = 'page' AND container_id = OLD.id;

            SELECT RAISE(ABORT, 'children must contain block ID strings')
            WHERE EXISTS (SELECT 1 FROM json_each(NEW.children) WHERE type != 'text');


                INSERT INTO sync_refs (container_kind, container_id, slot, position, block_id)
                VALUES ('page', NEW.id, 'title', 0, NEW.title_block_id);


            INSERT INTO sync_refs (container_kind, container_id, slot, position, block_id)
            SELECT 'page', NEW.id, 'children', key, value FROM json_each(NEW.children);

            END;
--> statement-breakpoint
CREATE TRIGGER pages_uses_delete AFTER DELETE ON pages
            BEGIN
                DELETE FROM sync_refs WHERE container_kind = 'page' AND container_id = OLD.id;
            END;
--> statement-breakpoint
CREATE TRIGGER blocks_uses_insert AFTER INSERT ON blocks
            BEGIN

            SELECT RAISE(ABORT, 'children must contain block ID strings')
            WHERE EXISTS (SELECT 1 FROM json_each(NEW.children) WHERE type != 'text');



            INSERT INTO sync_refs (container_kind, container_id, slot, position, block_id)
            SELECT 'block', NEW.id, 'children', key, value FROM json_each(NEW.children);

            END;
--> statement-breakpoint
CREATE TRIGGER blocks_uses_update AFTER UPDATE OF id, children ON blocks
            WHEN NEW.id IS NOT OLD.id OR NEW.children IS NOT OLD.children
            BEGIN
                DELETE FROM sync_refs WHERE container_kind = 'block' AND container_id = OLD.id;

            SELECT RAISE(ABORT, 'children must contain block ID strings')
            WHERE EXISTS (SELECT 1 FROM json_each(NEW.children) WHERE type != 'text');



            INSERT INTO sync_refs (container_kind, container_id, slot, position, block_id)
            SELECT 'block', NEW.id, 'children', key, value FROM json_each(NEW.children);

            END;
--> statement-breakpoint
CREATE TRIGGER blocks_uses_delete AFTER DELETE ON blocks
            BEGIN
                DELETE FROM sync_refs WHERE container_kind = 'block' AND container_id = OLD.id;
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
CREATE TRIGGER attrs_meta_modified_insert AFTER INSERT ON attrs_meta

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER attrs_meta_modified_update AFTER UPDATE ON attrs_meta
                WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.name IS NOT OLD.name OR NEW.metadata IS NOT OLD.metadata
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = CAST(round(unixepoch('subsec') * 1000) AS INTEGER);
                END;
--> statement-breakpoint
CREATE TRIGGER attrs_meta_modified_delete AFTER DELETE ON attrs_meta

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