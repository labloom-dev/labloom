import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import Database from "better-sqlite3";
import { FeedService } from "../main/feed/service";
import { EditHistory } from "../main/knowledge/history";
import { ReminderService } from "../main/knowledge/reminders";
import { KnowledgeService } from "../main/knowledge/service";
import { createWorkspaceDatabase } from "../main/storage/database";
import { generatedMigrations } from "../main/storage/migrations/generated";
import { runMigrations } from "../main/storage/migrations/runner";
import { v1 } from "../main/storage/migrations/v1";
import { v2 } from "../main/storage/migrations/v2";
import { v3 } from "../main/storage/migrations/v3";
import { v4 } from "../main/storage/migrations/v4";

test("upgrading old timestamps preserves both undo formats, option cleanup, ordering, due time and milliseconds", t => {
    const db = new Database(":memory:");
    t.after(() => db.close());
    const migrations = [v1, v2, v3, v4, ...generatedMigrations];
    runMigrations(db, migrations.filter(m => m.to <= 9));
    const first = "2026-11-07T17:12:56.210Z", last = "2026-11-07T17:32:56.208Z";
    const millis = Date.parse(first), seconds = Math.floor(millis / 1000), later = Math.floor(Date.parse(last) / 1000);
    const field = "custom:" + randomUUID(), a = randomUUID(), b = randomUUID();
    db.prepare("INSERT INTO attrs (id,type) VALUES (?, 'datetime')").run(field);
    db.prepare("INSERT INTO workspace_meta (id,name,created_at,last_modified_at) VALUES ('ws','Fixture',?,?)").run(first, last);
    const write = db.prepare("INSERT INTO page_attrs VALUES (?,?,?) ON CONFLICT DO UPDATE SET value=excluded.value");
    for (const [id, date] of [[a, first], [b, last]]) {
        const title = randomUUID();
        db.prepare("INSERT INTO blocks(id,type,content) VALUES (?,'title',?)").run(title, id === a ? "A" : "B");
        db.prepare("INSERT INTO pages(id,kind,title_block_id) VALUES (?,'event',?)").run(id, title);
        for (const attr of ["created_at", "modified_at"]) write.run(id, attr, date);
        write.run(id, "deleted", 0);
        write.run(id, "independent", 1);
        write.run(id, "priority", "normal");
        write.run(id, "task_status", "todo");
    }
    write.run(a, "links", JSON.stringify([b]));
    db.prepare("INSERT INTO link_index VALUES ('page',?,'links','page',?)").run(a, b);
    write.run(a, field, last);
    write.run(a, "reminder_at", last);
    db.prepare("INSERT INTO reminder_schedules VALUES ('r',?,?,'UTC','pending')").run(a, last);
    db.prepare("INSERT INTO notifications (id,schedule_id,page_id,title,created_at) VALUES ('n','past',?,'A',?)").run(a, first);
    db.prepare("INSERT INTO feed_sources(id,name,url,last_refreshed) VALUES ('source','A','https://example.com',?)").run(first);
    const insert = db.prepare("INSERT INTO feed_items(id,source_id,external_id,title,authors,summary,published_at) VALUES (?,'source',?,'A','','',?)");
    for (const [id, date] of [["first", first], ["last", last], ["undated", null]]) insert.run(id, id, date);
    db.prepare("UPDATE workspace_meta SET last_modified_at=?").run(last);

    const page = { id: a, kind: "event", children: [], titleBlockId: db.prepare("SELECT title_block_id FROM pages WHERE id=?").pluck().get(a) };
    const stateKey = "page:" + a;
    const legacy = (value: string): string => JSON.stringify({ [stateKey]: { page, attrs: [{ attrId: field, value }, { attrId: "task_status", value: "todo" }] } });
    const sparse = (value: string): string => JSON.stringify({ [stateKey]: { values: { [field]: { value }, priority: { value: "high" } } } });
    db.exec("INSERT INTO edit_tabs VALUES ('tab','second'),('keys',NULL)");
    const node = db.prepare("INSERT INTO undo_nodes(id,tab_id,parent_id,page_id,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?)");
    node.run("first", "tab", null, a, legacy(first), legacy(last), first);
    node.run("second", "tab", "first", a, sparse(first), sparse(last), last);
    node.run("union", "keys", null, a, JSON.stringify({ "block:before": null }), JSON.stringify({ "block:after": null }), first);
    runMigrations(db, migrations);

    assert.deepEqual(db.prepare("SELECT object_key FROM undo_objects WHERE node_id='union' ORDER BY object_key").pluck().all(), ["block:after", "block:before"]);
    assert.equal(db.prepare("SELECT retains FROM link_index WHERE source_id=? AND target_id=?").pluck().get(a, b), 1);
    const orm = createWorkspaceDatabase(db), service = new KnowledgeService(orm), history = new EditHistory(service);
    for (const sort of ["modified", "created"] as const) assert.deepEqual(service.list({ sort }).items.map(p => p.id), [b, a]);
    for (const id of [a, b]) {
        const values = service.get(id).attributes;
        assert.ok(!Object.hasOwn(values, "task_status") && !Object.hasOwn(values, "priority"));
    }
    assert.equal(service.get(a).attributes.created_at, seconds);
    assert.equal(service.get(a).attributes.modified_at, seconds);
    assert.equal(service.get(a).attributes.reminder_at, later);
    assert.deepEqual(db.prepare("SELECT created_at,last_modified_at FROM workspace_meta").get(), { created_at: millis, last_modified_at: Date.parse(last) });
    assert.equal(db.prepare("SELECT created_at FROM undo_nodes WHERE id='first'").pluck().get(), millis);
    assert.equal(db.prepare("SELECT created_at FROM notifications WHERE id='n'").pluck().get(), millis);
    const feed = new FeedService(orm).getState({});
    assert.equal(feed.sources[0].lastRefreshed, millis);
    assert.deepEqual(feed.items.map(item => [item.id, item.publishedAt]), [["last", Date.parse(last)], ["first", millis], ["undated", null]]);
    for (const [table, columns] of Object.entries({ workspace_meta: ["created_at", "last_modified_at"], feed_sources: ["last_refreshed"], feed_items: ["published_at"], undo_nodes: ["created_at"], notifications: ["created_at"], reminder_schedules: ["scheduled_at"] })) {
        for (const col of columns) assert.deepEqual(db.prepare(`SELECT DISTINCT typeof(${col}) FROM ${table} WHERE ${col} IS NOT NULL`).pluck().all(), ["integer"]);
    }
    const reminders = new ReminderService(service);
    assert.deepEqual(reminders.due(later * 1000 - 1), []);
    assert.deepEqual(reminders.due(later * 1000).map(n => n.pageId), [a]);
    for (const [direction, expected] of [["undo", seconds], ["undo", seconds], ["redo", later], ["redo", later]] as const) {
        assert.equal(history.apply("tab", direction).status, "saved");
        assert.deepEqual(db.prepare("SELECT value,typeof(value) AS type FROM page_attrs WHERE page_id=? AND attr_id=?").get(a, field), { value: expected, type: "integer" });
        assert.equal(db.prepare("SELECT count(*) FROM page_attrs WHERE page_id=? AND attr_id IN ('priority','task_status')").pluck().get(a), 0);
    }
    assert.deepEqual(db.pragma("foreign_key_check"), []);
});