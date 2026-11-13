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