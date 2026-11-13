import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { FeedService } from "../main/feed/service";
import { createWorkspaceDatabase } from "../main/storage/database";
import { attrsMeta, blocks, syncRefs, feedItems, pageAttrs, pages, workspaceMeta } from "../main/storage/tables";
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

function entry(externalId: string): FeedEntry {
    return { externalId, title: "Research", url: "https://example.org/article", pdfURL: null, authors: "Author", summary: "Summary", content: "", fullContent: false, publishedAt: Date.parse(timestamp) };
}

test("Drizzle round-trips JSON, nullable columns, and STRICT ANY values on the workspace connection", t => {
    const { db, database, info } = track(t, createWorkspace(directory()));
    assert.equal(db.$client, database);
    db.insert(blocks).values([{ id: "title", type: "title" }, { id: "child", type: "paragraph", content: "Text" }]).run();
    db.insert(pages).values({ id: "page", kind: "editable", titleBlockId: "title", children: ["child", "child"] }).run();
    db.insert(attrsMeta).values({ name: "属性", id: "custom:value", type: "string", metadata: {} }).run();
    db.insert(pageAttrs).values({ pageId: "page", attrId: "custom:value", value: "" }).run();
    assert.equal(db.select().from(pageAttrs).where(eq(pageAttrs.attrId, "custom:value")).get()!.value, "");
    for (const value of ["000123", 123, 0.5, Buffer.from([0, 1, 255])]) {
        db.update(pageAttrs).set({ value }).where(eq(pageAttrs.attrId, "custom:value")).run();
        assert.deepEqual(db.select().from(pageAttrs).where(eq(pageAttrs.attrId, "custom:value")).get()!.value, value);
    }
    db.update(workspaceMeta).set({ settings: { language: "zh-CN", nested: { enabled: true } } }).run();
    assert.deepEqual(db.select().from(blocks).where(eq(blocks.id, "title")).get(), { id: "title", type: "title", content: null, children: [] });
    assert.deepEqual(db.select().from(attrsMeta).where(eq(attrsMeta.id, "custom:value")).get()!.metadata, {});
    assert.deepEqual(db.select().from(syncRefs).where(and(eq(syncRefs.containerId, "page"), eq(syncRefs.slot, "children")))
        .orderBy(syncRefs.position).all().map(use => [use.position, use.blockId]), [[0, "child"], [1, "child"]]);
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
    const uses = db.select().from(syncRefs).all();
    assert.throws(() => db.transaction(tx => {
        tx.update(pages).set({ children: [] }).run();
        tx.update(blocks).set({ content: "changed" }).run();
        throw new Error("Abort edit");
    }), /Abort edit/);
    assert.deepEqual(db.select().from(pages).get()!.children, ["missing"]);
    assert.equal(db.select().from(blocks).get()!.content, null);
    assert.deepEqual(db.select().from(syncRefs).all(), uses);
    assert.deepEqual(db.select().from(workspaceMeta).get(), before);
});

test("FeedService construction does not create or upgrade schema", t => {
    const database = new Database(":memory:");
    t.after(() => database.close());
    new FeedService(createWorkspaceDatabase(database));
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_master").all(), []);
    assert.equal(database.pragma("user_version", { simple: true }), 0);
});

test("Feed writes remain atomic when an entry fails halfway through a batch", async t => {
    const { db } = track(t, createWorkspace(directory()));
    let entries = [entry("original")];
    const service = new FeedService(db, async request => ({ entries, title: "", url: request.url, etag: null, lastModified: null }));
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