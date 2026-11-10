import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { FeedService } from "../main/feed/service";
import { createWorkspaceDatabase } from "../main/storage/database";
import { runMigrations } from "../main/storage/migrations/runner";
import { v1 } from "../main/storage/migrations/v1";
import { v2 } from "../main/storage/migrations/v2";
import { v3 } from "../main/storage/migrations/v3";
import { workspaceFormatVersion } from "../main/storage/schema";
import { attrs, blocks, blockUses, feedItems, pageAttrs, pages, workspaceMeta } from "../main/storage/tables";
import { WorkspaceUpgradeError } from "../main/storage/upgrade";
import { createWorkspace, openWorkspace, type OpenWorkspace } from "../main/storage/workspace";
import { type FeedEntry } from "../shared/types/feed";

const testRoot = process.env.LABLOOM_TEST_ROOT;
if (!testRoot) throw new Error("Run these tests with node tests/run-workspace.mjs.");
const timestamp = "2001-02-03T04:05:06.789Z";

function directory(): string {
    return mkdtempSync(join(testRoot!, "drizzle-"));
}

function track(t: TestContext, workspace: OpenWorkspace): OpenWorkspace {
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    return workspace;
}

function versionThree(): { root: string; id: string; } {
    const root = directory();
    const id = randomUUID();
    mkdirSync(join(root, "attachments"));
    const database = new Database(join(root, "workspace.sqlite"));
    try {
        database.pragma("application_id = 0x4c424c4d");
        database.pragma("foreign_keys = ON");
        runMigrations(database, [v1, v2, v3]);
        database.prepare("INSERT INTO workspace_meta (id, name, created_at, last_modified_at) VALUES (?, 'Existing workspace', ?, ?)")
            .run(id, timestamp, timestamp);
    }
    finally {
        database.close();
    }
    return { root, id };
}

function entry(externalId: string): FeedEntry {
    return { externalId, title: "Research", url: "https://example.org/article", authors: "Author", summary: "Summary", publishedAt: Date.parse(timestamp) };
}

test("Drizzle round-trips JSON, nullable columns, and STRICT ANY values on the workspace connection", t => {
    const { db, database, info } = track(t, createWorkspace(directory()));
    assert.equal(db.$client, database);
    db.insert(blocks).values([{ id: "title", type: "title" }, { id: "child", type: "paragraph", content: "Text" }]).run();
    db.insert(pages).values({ id: "page", kind: "editable", titleBlockId: "title", children: ["child", "child"] }).run();
    db.insert(attrs).values({ id: "custom:value", type: "string", metadata: { options: ["one"] } }).run();
    db.insert(pageAttrs).values({ pageId: "page", attrId: "custom:value" }).run();
    assert.equal(db.select().from(pageAttrs).where(eq(pageAttrs.attrId, "custom:value")).get()!.value, null);
    for (const value of ["000123", 123, 0.5, Buffer.from([0, 1, 255]), null]) {
        db.update(pageAttrs).set({ value }).where(eq(pageAttrs.attrId, "custom:value")).run();
        assert.deepEqual(db.select().from(pageAttrs).where(eq(pageAttrs.attrId, "custom:value")).get()!.value, value);
    }
    db.update(workspaceMeta).set({ settings: { language: "zh-CN", nested: { enabled: true } } }).run();
    assert.deepEqual(db.select().from(blocks).where(eq(blocks.id, "title")).get(), { id: "title", type: "title", content: null, children: [] });
    assert.deepEqual(db.select().from(attrs).where(eq(attrs.id, "custom:value")).get()!.metadata, { options: ["one"] });
    assert.deepEqual(db.select().from(blockUses).where(and(eq(blockUses.containerId, "page"), eq(blockUses.slot, "children")))
        .orderBy(blockUses.position).all().map(use => [use.position, use.blockId]), [[0, "child"], [1, "child"]]);
    database.close();
    const reopened = track(t, openWorkspace(info.path, info.id));
    assert.deepEqual(reopened.db.select().from(pages).get()!.children, ["child", "child"]);
    assert.deepEqual(reopened.db.select().from(workspaceMeta).get()!.settings, { language: "zh-CN", nested: { enabled: true } });
});

test("Drizzle transactions roll back rows, trigger-maintained references, and modification times together", t => {
    const { db } = track(t, createWorkspace(directory()));
    db.insert(blocks).values({ id: "title", type: "title" }).run();
    db.insert(pages).values({ id: "page", kind: "editable", titleBlockId: "title", children: ["missing"] }).run();
    const before = db.select().from(workspaceMeta).get();
    const uses = db.select().from(blockUses).all();
    assert.throws(() => db.transaction(tx => {
        tx.update(pages).set({ children: [] }).run();
        tx.update(blocks).set({ content: "changed" }).run();
        throw new Error("Abort edit");
    }), /Abort edit/);
    assert.deepEqual(db.select().from(pages).get()!.children, ["missing"]);
    assert.equal(db.select().from(blocks).get()!.content, null);
    assert.deepEqual(db.select().from(blockUses).all(), uses);
    assert.deepEqual(db.select().from(workspaceMeta).get(), before);
    assert.throws(() => db.delete(attrs).where(eq(attrs.id, "deleted")).run(), /cannot be deleted/);
    assert.throws(() => db.update(pageAttrs).set({ value: "1" }).where(eq(pageAttrs.attrId, "deleted")).run(), /must be NULL, 0, or 1/);
});

test("FeedService construction does not create or upgrade schema", t => {
    const database = new Database(":memory:");
    t.after(() => database.close());
    new FeedService(createWorkspaceDatabase(database));
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_master").all(), []);
    assert.equal(database.pragma("user_version", { simple: true }), 0);
});

test("version 3 workspaces gain feed tables during the backed-up workspace upgrade", t => {
    const { root, id } = versionThree();
    const { database, db } = track(t, openWorkspace(root, id));
    assert.equal(database.pragma("user_version", { simple: true }), workspaceFormatVersion);
    assert.deepEqual(new FeedService(db).getState({}), { sources: [], items: [], total: 0 });
    assert.equal(db.select().from(workspaceMeta).get()!.lastModifiedAt, Date.parse(timestamp));
    const paths = readdirSync(join(root, "backups"));
    assert.equal(paths.length, 1);
    const backup = new Database(join(root, "backups", paths[0]), { readonly: true });
    try {
        assert.equal(backup.pragma("user_version", { simple: true }), 3);
        assert.deepEqual(backup.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'feed_%'").all(), []);
    }
    finally {
        backup.close();
    }
});

test("upgrading existing FeedService tables preserves source IDs, entries, and read state", t => {
    const { root, id } = versionThree();
    const old = new Database(join(root, "workspace.sqlite"));
    try {
        // Frozen schema from FeedService before workspace migration v4 existed.
        old.exec(`
            CREATE TABLE feed_sources (
                id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
                last_refreshed TEXT, last_added INTEGER NOT NULL DEFAULT 0, error TEXT
            );
            CREATE TABLE feed_items (
                id TEXT PRIMARY KEY NOT NULL, source_id TEXT NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
                external_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT, authors TEXT NOT NULL,
                summary TEXT NOT NULL, published_at TEXT, is_read INTEGER NOT NULL DEFAULT 0,
                UNIQUE (source_id, external_id)
            );
            CREATE INDEX feed_items_date ON feed_items(published_at DESC);
            INSERT INTO feed_sources (id, name, url) VALUES ('source', 'Saved feed', 'https://example.org/feed');
            INSERT INTO feed_items (id, source_id, external_id, title, authors, summary, is_read)
                VALUES ('item', 'source', 'external', 'Saved article', 'Author', 'Summary', 1);
        `);
    }
    finally {
        old.close();
    }
    const { db, database } = track(t, openWorkspace(root, id));
    const service = new FeedService(db);
    const state = service.getState({});
    assert.equal(state.sources[0].id, "source");
    assert.equal(state.sources[0].unreadCount, 0);
    assert.equal(state.items[0].id, "item");
    assert.equal(state.items[0].externalId, "external");
    assert.equal(state.items[0].isRead, true);
    assert.equal(db.select().from(workspaceMeta).get()!.lastModifiedAt, Date.parse(timestamp));
    service.setRead("item", false);
    assert.equal(database.prepare("SELECT is_read FROM feed_items WHERE id = 'item'").pluck().get(), 0);
    assert.equal(service.getState({}).sources[0].unreadCount, 1);
    service.removeSource("source");
    assert.deepEqual(db.select().from(feedItems).all(), []);
});

test("a failed feed schema upgrade rolls back version and newly created tables", t => {
    const { root, id } = versionThree();
    const old = new Database(join(root, "workspace.sqlite"));
    old.exec("CREATE TABLE feed_items (sentinel TEXT); INSERT INTO feed_items VALUES ('preserve me');");
    old.close();
    assert.throws(() => openWorkspace(root, id), error => {
        assert.ok(error instanceof WorkspaceUpgradeError);
        assert.equal(error.failure.stage, "migration");
        assert.equal(error.failure.fromVersion, 3);
        assert.ok(error.failure.backupPath);
        return true;
    });
    const database = new Database(join(root, "workspace.sqlite"), { readonly: true });
    t.after(() => database.close());
    assert.equal(database.pragma("user_version", { simple: true }), 3);
    assert.deepEqual(database.prepare("SELECT * FROM feed_items").all(), [{ sentinel: "preserve me" }]);
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'feed_sources'").get(), undefined);
});

test("Feed writes remain atomic when an entry fails halfway through a batch", async t => {
    const { db } = track(t, createWorkspace(directory()));
    let entries = [entry("original")];
    const service = new FeedService(db, async () => entries);
    const id = await service.saveSource({ name: "Feed", url: "https://example.org/feed" });
    const item = service.getState({}).items[0];
    service.setRead(item.id, true);
    const refreshed = service.getState({}).sources[0].lastRefreshed;
    entries = [entry("new"), { ...entry("invalid"), title: null as unknown as string }];
    await service.refresh(id);
    let state = service.getState({});
    assert.equal(state.total, 1);
    assert.equal(state.items[0].id, item.id);
    assert.equal(state.items[0].isRead, true);
    assert.equal(state.sources[0].lastRefreshed, refreshed);
    assert.equal(state.sources[0].lastAdded, 0);
    assert.ok(state.sources[0].error);
    await assert.rejects(service.saveSource({ id, name: "Changed", url: "https://example.org/changed" }));
    state = service.getState({});
    assert.equal(state.sources[0].name, "Feed");
    assert.equal(state.sources[0].url, "https://example.org/feed");
    assert.equal(state.total, 1);
});