import type Database from "better-sqlite3";
import { runMigrations } from "./migrations/runner";
import { v1 } from "./migrations/v1";
import { v2 } from "./migrations/v2";
import { v3 } from "./migrations/v3";

// Append new migrations; never edit a published version to introduce a new schema.
const workspaceMigrations = [v1, v2, v3] as const;
export const workspaceFormatVersion = workspaceMigrations[workspaceMigrations.length - 1].to;

export function migrateWorkspaceSchema(database: Database.Database): void {
    runMigrations(database, workspaceMigrations);
}

// A fresh database follows the same version history, inside the creation transaction.
export function createWorkspaceSchema(database: Database.Database): void {
    migrateWorkspaceSchema(database);
}

const blockUseColumns = "container_kind, container_id, slot, position, block_id";

export function rebuildBlockUses(database: Database.Database): void {
    database.transaction(() => {
        database.exec(`
            DELETE FROM block_uses;
            INSERT INTO block_uses (${blockUseColumns})
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