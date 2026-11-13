import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FeedService } from "../main/feed/service";
import { EditHistory } from "../main/knowledge/history";
import { KnowledgeService } from "../main/knowledge/service";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";

test("attribute and timer timestamps use seconds while workspace and published item times retain milliseconds", async t => {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "timestamps-"))), { database: sql, db, info } = workspace;
    t.after(() => {
 if (sql.open) sql.close();
});
    const first = Date.parse("2026-11-07T17:12:56.210Z"), later = Date.parse("2026-11-07T17:32:56.208Z"), seconds = Math.floor(first / 1000), due = Math.floor(later / 1000);
    let now = first;
    const service = new KnowledgeService(db, () => "UTC", () => now), history = new EditHistory(service), page = service.create("event", "A");
    service.commitEdit({ pageId: page.id, tabId: "time", batch: 0, blocks: [], attributes: { schedule_start: due } });
    service.timers.set(page.id, "schedule_start", 0, true);
    now = due * 1000 - 1; await service.timers.check(() => assert.fail("too early"));
    now = later; const notices: string[] = []; await service.timers.check(notice => notices.push(notice.pageId));
    assert.deepEqual(notices, [page.id]);
    assert.equal(sql.prepare("SELECT fired_at FROM timers").pluck().get(), due);
    assert.equal(service.get(page.id).attributes.schedule_start, due);
    history.apply("time", "undo"); assert.equal(service.get(page.id).attributes.schedule_start, null);
    history.apply("time", "redo"); assert.equal(service.get(page.id).attributes.schedule_start, due);
    const feed = new FeedService(db, async request => ({ title: "", url: request.url, etag: null, lastModified: null,
        entries: [{ externalId: "item", title: "B", url: null, pdfURL: null, authors: "", summary: "", content: "", fullContent: false, publishedAt: first }] }), undefined, () => later);
    const source = await feed.saveSource({ name: "A", url: "https://example.org/feed" });
    assert.equal(feed.getState({}).items[0].publishedAt, first);
    assert.equal(service.get(source).attributes.feed_last_refreshed, due);
    for (const [table, columns] of Object.entries({ workspace_meta: ["created_at", "last_modified_at"], feed_items: ["published_at"], timers: ["due_at"] })) {
        for (const column of columns) assert.deepEqual(sql.prepare(`SELECT DISTINCT typeof(${column}) FROM ${table} WHERE ${column} IS NOT NULL`).pluck().all(), ["integer"]);
    }
    sql.close(); const reopened = openWorkspace(info.path); t.after(() => reopened.database.close());
    assert.equal(new KnowledgeService(reopened.db).get(page.id).attributes.schedule_start, due);
    assert.equal(new FeedService(reopened.db).getState({}).items[0].publishedAt, first);
    assert.deepEqual(reopened.database.pragma("foreign_key_check"), []);
});