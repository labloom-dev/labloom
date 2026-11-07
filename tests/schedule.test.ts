import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { ReminderService } from "../main/knowledge/reminders";
import { toInstant, wallTime } from "../shared/content/time";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { knowledge: KnowledgeService; reminders: ReminderService } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "schedule-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const knowledge = new KnowledgeService(workspace.db);
    const reminders = new ReminderService(knowledge);
    knowledge.onScheduled = (before, after) => reminders.reconcile(before, after);
    return { ...workspace, knowledge, reminders };
}

test("reminders deliver once after restart, cancel on recycling, and do not rearm on restoration", t => {
    const setup = fixture(t);
    let { knowledge, reminders } = setup;
    const task = knowledge.create("task", "Review paper"), at = "2020-01-01T12:00:00.000Z";
    const edit = (value: string | null): ReturnType<KnowledgeService["mutate"]> => knowledge.mutate({ type: "edit", edit: { pageId: task.id, tabId: "schedule-test", version: knowledge.get(task.id).version, attributes: { reminder_at: value } } });
    edit(at);
    assert.equal(setup.database.prepare("SELECT COUNT(*) AS count FROM reminder_schedules WHERE state = 'pending'").get()!.count, 1);
    setup.database.close();
    const reopened = openWorkspace(setup.info.path);
    t.after(() => reopened.database.close());
    knowledge = new KnowledgeService(reopened.db);
    reminders = new ReminderService(knowledge);
    knowledge.onScheduled = (before, after) => reminders.reconcile(before, after);
    assert.equal(reminders.due().length, 1);
    assert.equal(reminders.due().length, 0);
    edit("2021-01-01T12:00:00.000Z");
    const command = { type: "trash" as const, ids: [task.id], tabId: "schedule-test" };
    const preview = knowledge.mutate(command);
    assert.equal(preview.status, "confirmation");
    if (preview.status === "confirmation") knowledge.mutate(command, preview.preview.token);
    assert.equal(reminders.due().length, 0);
    knowledge.mutate({ type: "restore", ids: [task.id], tabId: "schedule-test" });
    assert.equal(knowledge.get(task.id).attributes.reminder_at, null);
    assert.equal(reminders.due().length, 0);
    assert.equal(reopened.database.prepare("SELECT COUNT(*) AS count FROM notifications").get()!.count, 1);
});

test("schedule input uses its selected timezone and detects missing or ambiguous wall times", () => {
    assert.equal(toInstant("2026-11-07T09:30", "Asia/Singapore"), "2026-11-07T01:30:00.000Z");
    assert.equal(wallTime("2026-11-07T01:30:00.000Z", "Asia/Singapore"), "2026-11-07T09:30");
    assert.throws(() => toInstant("2026-03-08T02:30", "America/New_York"), /不存在/);
    assert.throws(() => toInstant("2026-11-01T01:30", "America/New_York"), /两次/);
});