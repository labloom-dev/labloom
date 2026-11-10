import { type WorkspaceMigration } from "./runner";

// Feed tables used to be created by FeedService. Adopt existing tables in place
// so subscriptions, entry identities, and read state survive the upgrade.
export const v4: WorkspaceMigration = {
    from: 3,
    to: 4,
    up(database) {
        database.exec(`
            CREATE TABLE IF NOT EXISTS feed_sources (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                last_refreshed TEXT,
                last_added INTEGER NOT NULL DEFAULT 0,
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS feed_items (
                id TEXT PRIMARY KEY NOT NULL,
                source_id TEXT NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
                external_id TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT,
                authors TEXT NOT NULL,
                summary TEXT NOT NULL,
                published_at TEXT,
                is_read INTEGER NOT NULL DEFAULT 0,
                UNIQUE (source_id, external_id)
            );
            CREATE INDEX IF NOT EXISTS feed_items_date ON feed_items(published_at DESC);
        `);
    }
};