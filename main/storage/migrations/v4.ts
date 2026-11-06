import type { WorkspaceMigration } from "./runner";

export const v4: WorkspaceMigration = {
    from: 3,
    to: 4,
    up(database) {
        const previous = database.prepare<[], { last_modified_at: string }>("SELECT last_modified_at FROM workspace_meta").get();
        database.exec(`
            CREATE TABLE page_details (
                page_id TEXT PRIMARY KEY NOT NULL REFERENCES pages(id),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0,
                independent INTEGER NOT NULL DEFAULT 1 CHECK (independent IN (0, 1)),
                pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
                search_text TEXT NOT NULL DEFAULT '',
                paper TEXT CHECK (paper IS NULL OR json_valid(paper)),
                schedule TEXT CHECK (schedule IS NULL OR json_valid(schedule))
            ) STRICT;
            INSERT INTO page_details (page_id, created_at, updated_at)
            SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM pages;
            CREATE TABLE workspace_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK (json_valid(value))) STRICT;
            CREATE TABLE tags (name TEXT PRIMARY KEY NOT NULL) STRICT;
            CREATE TABLE page_tags (
                page_id TEXT NOT NULL REFERENCES pages(id),
                name TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE ON DELETE CASCADE,
                PRIMARY KEY (page_id, name)
            ) STRICT;
            CREATE TABLE page_links (
                id TEXT PRIMARY KEY NOT NULL,
                source_id TEXT NOT NULL REFERENCES pages(id),
                target_id TEXT NOT NULL REFERENCES pages(id),
                block_id TEXT,
                mode TEXT NOT NULL CHECK (mode IN ('reference', 'sync')),
                writable INTEGER NOT NULL DEFAULT 0 CHECK (writable IN (0, 1))
            ) STRICT;
            CREATE INDEX page_links_target ON page_links(target_id);
            CREATE TABLE attachments (
                id TEXT PRIMARY KEY NOT NULL,
                page_id TEXT NOT NULL REFERENCES pages(id),
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                hash TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                position TEXT CHECK (position IS NULL OR json_valid(position))
            ) STRICT;
            CREATE TABLE annotations (
                id TEXT PRIMARY KEY NOT NULL,
                page_id TEXT NOT NULL UNIQUE REFERENCES pages(id),
                attachment_id TEXT NOT NULL REFERENCES attachments(id),
                page_number INTEGER NOT NULL,
                quote TEXT NOT NULL,
                color TEXT NOT NULL,
                rects TEXT NOT NULL CHECK (json_valid(rects))
            ) STRICT;
            CREATE TABLE visits (
                page_id TEXT PRIMARY KEY NOT NULL REFERENCES pages(id),
                visited_at TEXT NOT NULL
            ) STRICT;
            CREATE TABLE reminders (
                id TEXT PRIMARY KEY NOT NULL,
                page_id TEXT NOT NULL REFERENCES pages(id),
                scheduled_at TEXT NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0,
                UNIQUE (page_id, scheduled_at)
            ) STRICT;
            INSERT INTO page_attrs (page_id, attr_id, value)
            SELECT id, 'deleted', NULL FROM pages WHERE kind NOT IN ('editable', 'paper')
            ON CONFLICT DO NOTHING;
            CREATE TRIGGER other_page_builtin_attrs_delete BEFORE DELETE ON page_attrs
            WHEN OLD.attr_id = 'deleted' AND EXISTS (SELECT 1 FROM pages WHERE id = OLD.page_id AND kind NOT IN ('editable', 'paper'))
            BEGIN SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.'); END;
            CREATE TRIGGER other_page_builtin_attrs_move BEFORE UPDATE OF page_id, attr_id ON page_attrs
            WHEN OLD.attr_id = 'deleted' AND (NEW.page_id IS NOT OLD.page_id OR NEW.attr_id IS NOT OLD.attr_id)
                AND EXISTS (SELECT 1 FROM pages WHERE id = OLD.page_id AND kind NOT IN ('editable', 'paper'))
            BEGIN SELECT RAISE(ABORT, 'A Labloom page cannot remove a builtin attribute.'); END;
            CREATE TRIGGER other_pages_builtin_attrs_insert AFTER INSERT ON pages
            WHEN NEW.kind NOT IN ('editable', 'paper')
            BEGIN
                INSERT INTO page_attrs (page_id, attr_id, value) VALUES (NEW.id, 'deleted', NULL);
            END;
        `);
        const columns: Record<string, string[]> = {
            page_details: ["created_at", "updated_at", "revision", "independent", "pinned", "search_text", "paper", "schedule"],
            tags: ["name"], page_tags: ["page_id", "name"], page_links: ["source_id", "target_id", "block_id", "mode", "writable"],
            attachments: ["name", "version", "hash", "size", "position"], annotations: ["page_id", "attachment_id", "page_number", "quote", "color", "rects"],
            workspace_settings: ["value"]
        };
        for (const [table, fields] of Object.entries(columns)) {
            for (const action of ["INSERT", "UPDATE", "DELETE"]) {
                database.exec(`CREATE TRIGGER ${table}_modified_${action.toLowerCase()} AFTER ${action} ON ${table}
                    ${action === "UPDATE" ? `WHEN ${fields.map(field => `NEW.${field} IS NOT OLD.${field}`).join(" OR ")}` : ""}
                    BEGIN UPDATE workspace_meta SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'); END;`);
            }
        }
        if (previous) database.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(previous.last_modified_at);
    }
};