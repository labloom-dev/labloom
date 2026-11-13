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
DROP VIEW `attribute_defaults`;
--> statement-breakpoint
DROP VIEW `builtin_page_attrs`;
--> statement-breakpoint
CREATE VIEW `attribute_defaults` AS SELECT column1 AS type, column2 AS value FROM (VALUES ('string', ''), ('number', null), ('boolean', 0), ('minute', null), ('hour', null), ('day', null), ('month', null), ('year', null), ('select', null), ('multiselect', '[]'), ('url', ''), ('page-link', null), ('page-links', '[]'), ('json', 'null'));
--> statement-breakpoint
CREATE VIEW `builtin_page_attrs` AS SELECT column1 AS kind, column2 AS attr_id, column3 AS type FROM (VALUES ('editable', 'deleted', 'boolean'), ('editable', 'independent', 'boolean'), ('editable', 'created_at', 'minute'), ('editable', 'modified_at', 'minute'), ('editable', 'recycle_reason', 'select'), ('editable', 'recycled_at', 'minute'), ('editable', 'pinned', 'boolean'), ('editable', 'tags', 'multiselect'), ('editable', 'links', 'page-links'), ('paper', 'deleted', 'boolean'), ('paper', 'independent', 'boolean'), ('paper', 'created_at', 'minute'), ('paper', 'modified_at', 'minute'), ('paper', 'recycle_reason', 'select'), ('paper', 'recycled_at', 'minute'), ('paper', 'pinned', 'boolean'), ('paper', 'tags', 'multiselect'), ('paper', 'links', 'page-links'), ('paper', 'paper_authors', 'string'), ('paper', 'paper_doi', 'string'), ('paper', 'paper_year', 'string'), ('paper', 'paper_venue', 'string'), ('paper', 'paper_url', 'url'), ('paper', 'paper_abstract', 'string'), ('paper', 'paper_keywords', 'string'), ('paper', 'source_snapshot', 'json'), ('paper', 'reading_position', 'json'), ('annotation', 'deleted', 'boolean'), ('annotation', 'independent', 'boolean'), ('annotation', 'created_at', 'minute'), ('annotation', 'modified_at', 'minute'), ('annotation', 'recycle_reason', 'select'), ('annotation', 'recycled_at', 'minute'), ('annotation', 'pinned', 'boolean'), ('annotation', 'tags', 'multiselect'), ('annotation', 'links', 'page-links'), ('annotation', 'annotation_paper', 'page-link'), ('annotation', 'annotation_anchor', 'string'), ('task', 'deleted', 'boolean'), ('task', 'independent', 'boolean'), ('task', 'created_at', 'minute'), ('task', 'modified_at', 'minute'), ('task', 'recycle_reason', 'select'), ('task', 'recycled_at', 'minute'), ('task', 'pinned', 'boolean'), ('task', 'tags', 'multiselect'), ('task', 'links', 'page-links'), ('task', 'task_status', 'select'), ('task', 'priority', 'select'), ('task', 'schedule_date', 'day'), ('task', 'schedule_start', 'minute'), ('task', 'schedule_end', 'minute'), ('task', 'reminder_at', 'minute'), ('event', 'deleted', 'boolean'), ('event', 'independent', 'boolean'), ('event', 'created_at', 'minute'), ('event', 'modified_at', 'minute'), ('event', 'recycle_reason', 'select'), ('event', 'recycled_at', 'minute'), ('event', 'pinned', 'boolean'), ('event', 'tags', 'multiselect'), ('event', 'links', 'page-links'), ('event', 'schedule_date', 'day'), ('event', 'schedule_start', 'minute'), ('event', 'schedule_end', 'minute'), ('event', 'reminder_at', 'minute'));
--> statement-breakpoint
-- Calendar values are a new representation; discard development text dates.
CREATE TEMP TABLE old_calendar_attrs AS SELECT id FROM attrs WHERE type = 'date';
--> statement-breakpoint
UPDATE page_attrs SET value = NULL WHERE attr_id IN (SELECT id FROM old_calendar_attrs);
--> statement-breakpoint
-- Whole affected undo trees must go, including both snapshot formats.
CREATE TEMP TABLE old_calendar_tabs AS
SELECT DISTINCT n.tab_id FROM undo_nodes n, json_tree(json_array(json(n.before_state), json(n.after_state))) e
WHERE e.key IN (SELECT id FROM old_calendar_attrs)
   OR (e.key = 'attrId' AND e.value IN (SELECT id FROM old_calendar_attrs));
--> statement-breakpoint
DELETE FROM undo_objects WHERE node_id IN (SELECT id FROM undo_nodes WHERE tab_id IN (SELECT tab_id FROM old_calendar_tabs));
--> statement-breakpoint
DELETE FROM undo_nodes WHERE tab_id IN (SELECT tab_id FROM old_calendar_tabs);
--> statement-breakpoint
UPDATE edit_tabs SET cursor = NULL WHERE id IN (SELECT tab_id FROM old_calendar_tabs);
--> statement-breakpoint
DROP TABLE old_calendar_tabs;
--> statement-breakpoint
DROP TABLE old_calendar_attrs;
--> statement-breakpoint
UPDATE attrs SET type = CASE WHEN type = 'datetime' THEN 'minute' ELSE 'day' END WHERE type IN ('date', 'datetime');
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