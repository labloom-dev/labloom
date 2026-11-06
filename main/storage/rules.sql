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
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER pages_modified_update AFTER UPDATE ON pages
                WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.title_block_id IS NOT OLD.title_block_id OR NEW.children IS NOT OLD.children
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER pages_modified_delete AFTER DELETE ON pages

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER blocks_modified_insert AFTER INSERT ON blocks

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER blocks_modified_update AFTER UPDATE ON blocks
                WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.content IS NOT OLD.content OR NEW.children IS NOT OLD.children
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER blocks_modified_delete AFTER DELETE ON blocks

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER attrs_modified_insert AFTER INSERT ON attrs

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER attrs_modified_update AFTER UPDATE ON attrs
                WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.metadata IS NOT OLD.metadata
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER attrs_modified_delete AFTER DELETE ON attrs

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER page_attrs_modified_insert AFTER INSERT ON page_attrs

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER page_attrs_modified_update AFTER UPDATE ON page_attrs
                WHEN NEW.page_id IS NOT OLD.page_id OR NEW.attr_id IS NOT OLD.attr_id OR NEW.value IS NOT OLD.value
                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER page_attrs_modified_delete AFTER DELETE ON page_attrs

                BEGIN
                    UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
--> statement-breakpoint
CREATE TRIGGER workspace_meta_modified AFTER UPDATE OF name, settings ON workspace_meta
        WHEN NEW.name IS NOT OLD.name OR NEW.settings IS NOT OLD.settings
        BEGIN
            UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
        END;
--> statement-breakpoint
CREATE TRIGGER builtin_attrs_delete BEFORE DELETE ON attrs
            WHEN OLD.id = 'deleted'
            BEGIN
                SELECT RAISE(ABORT, 'Labloom builtin attributes cannot be deleted.');
            END;
--> statement-breakpoint
CREATE TRIGGER builtin_attrs_update BEFORE UPDATE OF id, type ON attrs
            WHEN (OLD.id = 'deleted' AND (NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type))
                OR (NEW.id = 'deleted' AND NEW.type != 'boolean')
            BEGIN
                SELECT RAISE(ABORT, 'The ID and type of a Labloom builtin attribute cannot be changed.');
            END;
--> statement-breakpoint
CREATE TRIGGER builtin_attrs_insert BEFORE INSERT ON attrs
            WHEN NEW.id = 'deleted' AND NEW.type != 'boolean'
            BEGIN
                SELECT RAISE(ABORT, 'The Labloom deleted attribute must have type boolean.');
            END;
--> statement-breakpoint
CREATE TRIGGER pages_builtin_attrs_insert AFTER INSERT ON pages
            WHEN NEW.kind IN ('editable', 'paper')
            BEGIN
                INSERT INTO page_attrs (page_id, attr_id, value) VALUES (NEW.id, 'deleted', NULL);
            END;
--> statement-breakpoint
CREATE TRIGGER pages_builtin_attrs_update AFTER UPDATE OF kind ON pages
            WHEN NEW.kind IN ('editable', 'paper') AND NEW.kind IS NOT OLD.kind
            BEGIN
                INSERT INTO page_attrs (page_id, attr_id, value) VALUES (NEW.id, 'deleted', NULL)
                ON CONFLICT (page_id, attr_id) DO NOTHING;
            END;
--> statement-breakpoint
CREATE TRIGGER pages_attrs_delete AFTER DELETE ON pages
            BEGIN
                DELETE FROM page_attrs WHERE page_id = OLD.id;
            END;
--> statement-breakpoint
CREATE TRIGGER page_builtin_attrs_delete BEFORE DELETE ON page_attrs
            WHEN OLD.attr_id = 'deleted'
                AND EXISTS (SELECT 1 FROM pages WHERE id = OLD.page_id AND kind IN ('editable', 'paper'))
            BEGIN
                SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.');
            END;
--> statement-breakpoint
CREATE TRIGGER page_builtin_attrs_move BEFORE UPDATE OF page_id, attr_id ON page_attrs
            WHEN OLD.attr_id = 'deleted' AND (NEW.page_id IS NOT OLD.page_id OR NEW.attr_id IS NOT OLD.attr_id)
                AND EXISTS (SELECT 1 FROM pages WHERE id = OLD.page_id AND kind IN ('editable', 'paper'))
            BEGIN
                SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.');
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