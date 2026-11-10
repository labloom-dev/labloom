DROP TRIGGER IF EXISTS "page_deleted_value_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_deleted_value_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_builtin_attrs_move";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_builtin_attrs_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_attrs_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_builtin_attrs_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "pages_builtin_attrs_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "builtin_attrs_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "builtin_attrs_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "builtin_attrs_delete";
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
CREATE TEMP TABLE builtin_check (valid INTEGER CHECK (valid = 1));
--> statement-breakpoint
INSERT INTO builtin_check SELECT 0 FROM attrs WHERE (id = 'deleted' AND type != 'boolean') OR (id = 'independent' AND type != 'boolean') OR (id = 'created_at' AND type != 'datetime') OR (id = 'modified_at' AND type != 'datetime') OR (id = 'recycle_reason' AND type != 'select') OR (id = 'recycled_at' AND type != 'datetime') OR (id = 'pinned' AND type != 'boolean') OR (id = 'tags' AND type != 'multiselect') OR (id = 'links' AND type != 'page-links') OR (id = 'paper_authors' AND type != 'string') OR (id = 'paper_doi' AND type != 'string') OR (id = 'paper_year' AND type != 'string') OR (id = 'paper_venue' AND type != 'string') OR (id = 'paper_url' AND type != 'url') OR (id = 'paper_abstract' AND type != 'string') OR (id = 'paper_keywords' AND type != 'string') OR (id = 'source_snapshot' AND type != 'json') OR (id = 'reading_position' AND type != 'json') OR (id = 'annotation_paper' AND type != 'page-link') OR (id = 'annotation_anchor' AND type != 'string') OR (id = 'task_status' AND type != 'select') OR (id = 'priority' AND type != 'select') OR (id = 'schedule_date' AND type != 'date') OR (id = 'schedule_start' AND type != 'datetime') OR (id = 'schedule_end' AND type != 'datetime') OR (id = 'schedule_zone' AND type != 'string') OR (id = 'reminder_at' AND type != 'datetime');
--> statement-breakpoint
DROP TABLE builtin_check;
--> statement-breakpoint
INSERT INTO attrs (id, type, metadata) VALUES
    ('deleted', 'boolean', '{}'),
    ('independent', 'boolean', '{"name":"独立保留"}'),
    ('created_at', 'datetime', '{"name":"创建时间","readonly":true}'),
    ('modified_at', 'datetime', '{"name":"修改时间","readonly":true}'),
    ('recycle_reason', 'select', '{"name":"回收原因","hidden":true,"readonly":true,"options":[{"id":"manual_delete","name":"手动删除"},{"id":"unreachable","name":"失去保留关系"}]}'),
    ('recycled_at', 'datetime', '{"name":"回收时间","hidden":true,"readonly":true}'),
    ('pinned', 'boolean', '{"name":"固定到侧栏"}'),
    ('tags', 'multiselect', '{"name":"标签","options":[]}'),
    ('links', 'page-links', '{"name":"关联页面"}'),
    ('paper_authors', 'string', '{"name":"作者"}'),
    ('paper_doi', 'string', '{"name":"DOI"}'),
    ('paper_year', 'string', '{"name":"发表时间"}'),
    ('paper_venue', 'string', '{"name":"期刊 / 会议"}'),
    ('paper_url', 'url', '{"name":"原文地址"}'),
    ('paper_abstract', 'string', '{"name":"摘要"}'),
    ('paper_keywords', 'string', '{"name":"关键词"}'),
    ('source_snapshot', 'json', '{"name":"原始来源","hidden":true,"readonly":true}'),
    ('reading_position', 'json', '{"name":"阅读位置","hidden":true,"readonly":true}'),
    ('annotation_paper', 'page-link', '{"name":"来源文献","readonly":true}'),
    ('annotation_anchor', 'string', '{"name":"原文锚点","hidden":true,"readonly":true}'),
    ('task_status', 'select', '{"name":"状态","options":[{"id":"todo","name":"未开始"},{"id":"doing","name":"进行中"},{"id":"done","name":"已完成"}]}'),
    ('priority', 'select', '{"name":"优先级","options":[{"id":"low","name":"低"},{"id":"normal","name":"普通"},{"id":"high","name":"高"}]}'),
    ('schedule_date', 'date', '{"name":"日期"}'),
    ('schedule_start', 'datetime', '{"name":"开始时间"}'),
    ('schedule_end', 'datetime', '{"name":"结束时间"}'),
    ('schedule_zone', 'string', '{"name":"时区"}'),
    ('reminder_at', 'datetime', '{"name":"提醒时间"}')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'deleted', NULL FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'independent', 1 FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'created_at', NULL FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'modified_at', NULL FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycle_reason', NULL FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycled_at', NULL FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'pinned', NULL FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'tags', NULL FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'links', NULL FROM pages WHERE kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'deleted', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'independent', 1 FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'created_at', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'modified_at', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycle_reason', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycled_at', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'pinned', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'tags', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'links', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'paper_authors', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'paper_doi', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'paper_year', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'paper_venue', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'paper_url', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'paper_abstract', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'paper_keywords', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'source_snapshot', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'reading_position', NULL FROM pages WHERE kind = 'paper' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'deleted', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'independent', 0 FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'created_at', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'modified_at', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycle_reason', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycled_at', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'pinned', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'tags', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'links', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'annotation_paper', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'annotation_anchor', NULL FROM pages WHERE kind = 'annotation' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'deleted', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'independent', 1 FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'created_at', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'modified_at', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycle_reason', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycled_at', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'pinned', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'tags', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'links', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'task_status', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'priority', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'schedule_date', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'schedule_start', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'schedule_end', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'schedule_zone', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'reminder_at', NULL FROM pages WHERE kind = 'task' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'deleted', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'independent', 1 FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'created_at', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'modified_at', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycle_reason', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'recycled_at', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'pinned', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'tags', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'links', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'task_status', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'priority', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'schedule_date', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'schedule_start', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'schedule_end', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'schedule_zone', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO page_attrs (page_id, attr_id, value) SELECT id, 'reminder_at', NULL FROM pages WHERE kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
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
--> statement-breakpoint
CREATE TRIGGER registered_attrs_delete BEFORE DELETE ON attrs WHEN OLD.id IN ('independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'paper_authors', 'paper_doi', 'paper_year', 'paper_venue', 'paper_url', 'paper_abstract', 'paper_keywords', 'source_snapshot', 'reading_position', 'annotation_paper', 'annotation_anchor', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at') BEGIN SELECT RAISE(ABORT, 'Labloom builtin attributes cannot be deleted.'); END;
--> statement-breakpoint
CREATE TRIGGER registered_attrs_update BEFORE UPDATE OF id, type ON attrs WHEN (OLD.id IN ('independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'paper_authors', 'paper_doi', 'paper_year', 'paper_venue', 'paper_url', 'paper_abstract', 'paper_keywords', 'source_snapshot', 'reading_position', 'annotation_paper', 'annotation_anchor', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at') AND (NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type)) OR (NEW.id = 'independent' AND NEW.type != 'boolean') OR (NEW.id = 'created_at' AND NEW.type != 'datetime') OR (NEW.id = 'modified_at' AND NEW.type != 'datetime') OR (NEW.id = 'recycle_reason' AND NEW.type != 'select') OR (NEW.id = 'recycled_at' AND NEW.type != 'datetime') OR (NEW.id = 'pinned' AND NEW.type != 'boolean') OR (NEW.id = 'tags' AND NEW.type != 'multiselect') OR (NEW.id = 'links' AND NEW.type != 'page-links') OR (NEW.id = 'paper_authors' AND NEW.type != 'string') OR (NEW.id = 'paper_doi' AND NEW.type != 'string') OR (NEW.id = 'paper_year' AND NEW.type != 'string') OR (NEW.id = 'paper_venue' AND NEW.type != 'string') OR (NEW.id = 'paper_url' AND NEW.type != 'url') OR (NEW.id = 'paper_abstract' AND NEW.type != 'string') OR (NEW.id = 'paper_keywords' AND NEW.type != 'string') OR (NEW.id = 'source_snapshot' AND NEW.type != 'json') OR (NEW.id = 'reading_position' AND NEW.type != 'json') OR (NEW.id = 'annotation_paper' AND NEW.type != 'page-link') OR (NEW.id = 'annotation_anchor' AND NEW.type != 'string') OR (NEW.id = 'task_status' AND NEW.type != 'select') OR (NEW.id = 'priority' AND NEW.type != 'select') OR (NEW.id = 'schedule_date' AND NEW.type != 'date') OR (NEW.id = 'schedule_start' AND NEW.type != 'datetime') OR (NEW.id = 'schedule_end' AND NEW.type != 'datetime') OR (NEW.id = 'schedule_zone' AND NEW.type != 'string') OR (NEW.id = 'reminder_at' AND NEW.type != 'datetime') BEGIN SELECT RAISE(ABORT, 'The ID and type of a Labloom builtin attribute cannot be changed.'); END;
--> statement-breakpoint
CREATE TRIGGER registered_attrs_insert BEFORE INSERT ON attrs WHEN (NEW.id = 'independent' AND NEW.type != 'boolean') OR (NEW.id = 'created_at' AND NEW.type != 'datetime') OR (NEW.id = 'modified_at' AND NEW.type != 'datetime') OR (NEW.id = 'recycle_reason' AND NEW.type != 'select') OR (NEW.id = 'recycled_at' AND NEW.type != 'datetime') OR (NEW.id = 'pinned' AND NEW.type != 'boolean') OR (NEW.id = 'tags' AND NEW.type != 'multiselect') OR (NEW.id = 'links' AND NEW.type != 'page-links') OR (NEW.id = 'paper_authors' AND NEW.type != 'string') OR (NEW.id = 'paper_doi' AND NEW.type != 'string') OR (NEW.id = 'paper_year' AND NEW.type != 'string') OR (NEW.id = 'paper_venue' AND NEW.type != 'string') OR (NEW.id = 'paper_url' AND NEW.type != 'url') OR (NEW.id = 'paper_abstract' AND NEW.type != 'string') OR (NEW.id = 'paper_keywords' AND NEW.type != 'string') OR (NEW.id = 'source_snapshot' AND NEW.type != 'json') OR (NEW.id = 'reading_position' AND NEW.type != 'json') OR (NEW.id = 'annotation_paper' AND NEW.type != 'page-link') OR (NEW.id = 'annotation_anchor' AND NEW.type != 'string') OR (NEW.id = 'task_status' AND NEW.type != 'select') OR (NEW.id = 'priority' AND NEW.type != 'select') OR (NEW.id = 'schedule_date' AND NEW.type != 'date') OR (NEW.id = 'schedule_start' AND NEW.type != 'datetime') OR (NEW.id = 'schedule_end' AND NEW.type != 'datetime') OR (NEW.id = 'schedule_zone' AND NEW.type != 'string') OR (NEW.id = 'reminder_at' AND NEW.type != 'datetime') BEGIN SELECT RAISE(ABORT, 'The Labloom builtin attribute has an incompatible type.'); END;
--> statement-breakpoint
CREATE TRIGGER pages_registered_attrs_insert AFTER INSERT ON pages WHEN NEW.kind IN ('editable', 'paper', 'annotation', 'task', 'event') BEGIN
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
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
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'task_status', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'priority', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_date', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_start', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_end', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_zone', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'reminder_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER pages_registered_attrs_update AFTER UPDATE OF kind ON pages WHEN NEW.kind IS NOT OLD.kind AND NEW.kind IN ('editable', 'paper', 'annotation', 'task', 'event') BEGIN
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'independent', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'created_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'modified_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycle_reason', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'recycled_at', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'pinned', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'tags', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'links', NULL WHERE NEW.kind = 'editable' ON CONFLICT (page_id, attr_id) DO NOTHING;
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
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'task_status', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'priority', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_date', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_start', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_end', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'schedule_zone', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
    INSERT INTO page_attrs (page_id, attr_id, value) SELECT NEW.id, 'reminder_at', NULL WHERE NEW.kind = 'event' ON CONFLICT (page_id, attr_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER page_registered_attrs_delete BEFORE DELETE ON page_attrs WHEN EXISTS (SELECT 1 FROM pages WHERE id = OLD.page_id AND ((kind = 'editable' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links')) OR (kind = 'paper' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'paper_authors', 'paper_doi', 'paper_year', 'paper_venue', 'paper_url', 'paper_abstract', 'paper_keywords', 'source_snapshot', 'reading_position')) OR (kind = 'annotation' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'annotation_paper', 'annotation_anchor')) OR (kind = 'task' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at')) OR (kind = 'event' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at')))) BEGIN SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.'); END;
--> statement-breakpoint
CREATE TRIGGER page_registered_attrs_move BEFORE UPDATE OF page_id, attr_id ON page_attrs WHEN (NEW.page_id IS NOT OLD.page_id OR NEW.attr_id IS NOT OLD.attr_id) AND EXISTS (SELECT 1 FROM pages WHERE id = OLD.page_id AND ((kind = 'editable' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links')) OR (kind = 'paper' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'paper_authors', 'paper_doi', 'paper_year', 'paper_venue', 'paper_url', 'paper_abstract', 'paper_keywords', 'source_snapshot', 'reading_position')) OR (kind = 'annotation' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'annotation_paper', 'annotation_anchor')) OR (kind = 'task' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at')) OR (kind = 'event' AND OLD.attr_id IN ('deleted', 'independent', 'created_at', 'modified_at', 'recycle_reason', 'recycled_at', 'pinned', 'tags', 'links', 'task_status', 'priority', 'schedule_date', 'schedule_start', 'schedule_end', 'schedule_zone', 'reminder_at')))) BEGIN SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.'); END;