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