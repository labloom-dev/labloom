import type Database from "better-sqlite3";
import { createBaseline } from "./migrations/runner";
export { baselineVersion as workspaceFormatVersion } from "./migrations/generated";
export { validateBaseline as validateWorkspaceSchema } from "./migrations/runner";

export function createWorkspaceSchema(database: Database.Database): void {
    createBaseline(database);
}

const syncRefColumns = "container_kind, container_id, slot, position, block_id";

export function rebuildSyncRefs(database: Database.Database): void {
    database.transaction(() => {
        database.exec(`
            DELETE FROM sync_refs;
            INSERT INTO sync_refs (${syncRefColumns})
            SELECT 'page', id, 'title', 0, title_block_id FROM pages
            UNION ALL
            SELECT 'page', pages.id, 'children', children.key, children.value
            FROM pages, json_each(pages.children) AS children
            UNION ALL
            SELECT 'block', blocks.id, 'children', children.key, children.value
            FROM blocks, json_each(blocks.children) AS children;
        `);
    })();
}