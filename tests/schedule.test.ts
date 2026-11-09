import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { ReminderService } from "../main/knowledge/reminders";
import { wallToSeconds, secondsToWall } from "../shared/content/time";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { knowledge: KnowledgeService; reminders: ReminderService } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "schedule-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const knowledge = new KnowledgeService(workspace.db);
    const reminders = new ReminderService(knowledge);
    knowledge.onScheduled = changes => reminders.reconcile(changes);
    return { ...workspace, knowledge, reminders };
}

test("reminders deliver once after restart, cancel on recycling, and do not rearm on restoration", t => {
    const setup = fixture(t);
    let { knowledge, reminders } = setup;
    const task = knowledge.create("task", "Review paper"), at = Date.UTC(2020, 0, 1, 12) / 1000;
    const edit = (value: number | null): ReturnType<KnowledgeService["commitEdit"]> => knowledge.commitEdit({ pageId: task.id, tabId: "schedule-test", batch: 1, blocks: [], attributes: { reminder_at: value } });
    edit(at);
    assert.equal(setup.database.prepare("SELECT COUNT(*) AS count FROM reminder_schedules WHERE state = 'pending'").get()!.count, 1);
    setup.database.close();
    const reopened = openWorkspace(setup.info.path);
    t.after(() => reopened.database.close());
    knowledge = new KnowledgeService(reopened.db);
    reminders = new ReminderService(knowledge);
    knowledge.onScheduled = changes => reminders.reconcile(changes);
    assert.equal(reminders.due().length, 1);
    assert.equal(reminders.due().length, 0);
    edit(Date.UTC(2021, 0, 1, 12) / 1000);
    const preview = knowledge.trash([task.id], "schedule-test");
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") knowledge.trash([task.id], "schedule-test", preview.preview.token);
    assert.equal(reminders.due().length, 0);
    knowledge.restore([task.id], "schedule-test");
    assert.equal(knowledge.get(task.id).attributes.reminder_at, null);
    assert.equal(reminders.due().length, 0);
    assert.equal(reopened.database.prepare("SELECT COUNT(*) AS count FROM notifications").get()!.count, 1);
});

test("schedule input uses its selected timezone and detects missing or ambiguous wall times", () => {
    assert.equal(wallToSeconds("2026-11-07T09:30", "Asia/Singapore"), Date.UTC(2026, 10, 7, 1, 30) / 1000);
    assert.equal(secondsToWall(Date.UTC(2026, 10, 7, 1, 30) / 1000, "Asia/Singapore"), "2026-11-07T09:30");
    assert.throws(() => wallToSeconds("2026-03-08T02:30", "America/New_York"), /不存在/);
    assert.throws(() => wallToSeconds("2026-11-01T01:30", "America/New_York"), /两次/);
});

test("editing one reminder reconciles only its page and delivers at the first due second", t => {
    const { knowledge, reminders, database } = fixture(t);
    const a = knowledge.create("task", "A", { reminder_at: 500 }), b = knowledge.create("event", "B", { reminder_at: 600 });
    const pending = database.prepare("SELECT * FROM reminder_schedules WHERE page_id=?");
    const untouched = pending.all(b.id), visited: string[][] = [];
    knowledge.onScheduled = changes => {
        visited.push(changes.map(change => change.pageId));
        reminders.reconcile(changes);
    };
    const update = (pageId: string, attributes: Record<string, number | boolean>): void => {
        assert.equal(knowledge.commitEdit({ pageId, tabId: "schedule", batch: 1, blocks: [], attributes }).status, "saved");
    };
    update(a.id, { reminder_at: 0 });
    update(b.id, { pinned: true });
    assert.deepEqual(visited, [[a.id]]);
    assert.deepEqual(pending.all(b.id), untouched);
    assert.deepEqual(reminders.due(-1), []);
    assert.deepEqual(reminders.due(234).map(n => n.pageId), [a.id]);
    assert.equal(database.prepare("SELECT created_at FROM notifications").pluck().get(), 234);
    assert.deepEqual(reminders.due(599999), []);
    assert.deepEqual(reminders.due(600000).map(n => n.pageId), [b.id]);
});