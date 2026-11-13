import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { EditHistory } from "../main/knowledge/history";
import { dayToSeconds, monthToSeconds, yearToSeconds, wallToSeconds } from "../shared/content/time";
import { type Notice } from "../shared/types/knowledge";
import { type AttributeValue } from "../shared/types/attributes";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { clock: { now: number; zone: string }; knowledge: KnowledgeService; history: EditHistory; delivered: Notice[]; bodies: string[]; check: () => Promise<void>; edit: (pageId: string, attributes: Record<string, AttributeValue>) => void } {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "timers-"))), clock = { now: Date.UTC(2026, 10, 13), zone: "Asia/Shanghai" };
    t.after(() => {
 if (ws.database.open) ws.database.close();
});
    const knowledge = new KnowledgeService(ws.db, () => clock.zone, () => clock.now), history = new EditHistory(knowledge), delivered: Notice[] = [], bodies: string[] = [];
    const check = (): Promise<void> => knowledge.timers.check((notice, body) => {
 delivered.push(notice); bodies.push(body);
});
    const edit = (pageId: string, attributes: Record<string, AttributeValue>): void => {
 assert.equal(knowledge.commitEdit({ pageId, tabId: "timers", batch: 0, blocks: [], attributes }).status, "saved");
};
    return { ...ws, clock, knowledge, history, delivered, bodies, check, edit };
}

test("two leads on the same time attribute fire once, and adding a reminder does not erase another notification", async t => {
    const f = fixture(t), due = Math.floor(f.clock.now / 1000) + 3600, page = f.knowledge.create("task", "组会", { schedule_start: due });
    f.knowledge.timers.set(page.id, "schedule_start", 600, true); f.knowledge.timers.set(page.id, "schedule_start", 0, true);
    f.clock.now = (due - 600) * 1000;
    await f.check(); assert.equal(f.delivered.length, 1); assert.match(f.bodies[0], /组会 · 开始时间/);
    f.knowledge.timers.set(page.id, "schedule_start", 300, true);
    assert.equal(f.knowledge.timers.notices().length, 1);
    await f.check(); assert.equal(f.delivered.length, 1);
    f.clock.now = due * 1000; await f.check(); assert.equal(f.delivered.length, 3);
    await f.check(); assert.equal(f.delivered.length, 3);
    assert.deepEqual(f.knowledge.timers.settings(page.id), { schedule_start: [0, 300, 600] });
});

test("day, month and year reminders use local 09:00, and changing zones recalculates them", async t => {
    const f = fixture(t), page = f.knowledge.create("event", "A", { schedule_date: dayToSeconds("2026-11-14") });
    f.knowledge.timers.set(page.id, "schedule_date", 86400, true);
    const query = f.database.prepare("SELECT due_at FROM timers WHERE page_id=? AND attr_id=?").pluck();
    assert.equal(query.get(page.id, "schedule_date"), wallToSeconds("2026-11-13T09:00", "Asia/Shanghai"));
    for (const [type, value, day] of [["month", monthToSeconds("2026-12"), "2026-12-01"], ["year", yearToSeconds("2027"), "2027-01-01"]] as const) {
        const id = "custom:" + randomUUID(); f.knowledge.setDefinition(id, { id, name: "A", type, metadata: {} }, "types");
        f.edit(page.id, { [id]: value }); f.knowledge.timers.set(page.id, id, 0, true);
        assert.equal(query.get(page.id, id), wallToSeconds(day + "T09:00", "Asia/Shanghai"));
    }
    f.clock.zone = "UTC"; f.knowledge.timers.recalculateAll();
    assert.equal(query.get(page.id, "schedule_date"), wallToSeconds("2026-11-13T09:00", "UTC"));
});

test("time edits and undo reschedule reminders; empty values retain their settings and past values do not catch up", async t => {
    const f = fixture(t), now = Math.floor(f.clock.now / 1000), page = f.knowledge.create("event", "A", { schedule_start: now + 3600 });
    f.knowledge.timers.set(page.id, "schedule_start", 0, true);
    f.edit(page.id, { schedule_start: now + 7200 });
    f.clock.now = (now + 3600) * 1000; await f.check(); assert.equal(f.delivered.length, 0);
    f.clock.now = now * 1000;
    assert.equal(f.history.apply("timers", "undo").status, "saved");
    assert.equal(f.database.prepare("SELECT due_at FROM timers").pluck().get(), now + 3600);
    assert.equal(f.history.apply("timers", "redo").status, "saved");
    assert.equal(f.database.prepare("SELECT due_at FROM timers").pluck().get(), now + 7200);
    f.edit(page.id, { schedule_start: null }); assert.equal(f.database.prepare("SELECT due_at FROM timers").pluck().get(), null);
    assert.equal(f.database.prepare("SELECT count(*) FROM timers").pluck().get(), 1);
    f.edit(page.id, { schedule_start: now - 1 }); await f.check(); assert.equal(f.delivered.length, 0);
    f.edit(page.id, { schedule_start: now + 100 }); f.clock.now = (now + 100) * 1000; await f.check(); assert.equal(f.delivered.length, 1);
});

test("recycle, restore, completed tasks, detached attributes and changed types update timer rows", async t => {
    const f = fixture(t), now = Math.floor(f.clock.now / 1000), page = f.knowledge.create("task", "A", { schedule_start: now + 1000 });
    f.knowledge.timers.set(page.id, "schedule_start", 0, true);
    const preview = f.knowledge.trash([page.id], "trash"); if (preview.status !== "confirmation") throw new Error("Expected confirmation");
    f.knowledge.trash([page.id], "trash", preview.preview.token);
    assert.equal(f.database.prepare("SELECT due_at FROM timers").pluck().get(), null);
    f.knowledge.restore([page.id], "restore"); assert.equal(f.database.prepare("SELECT due_at FROM timers").pluck().get(), now + 1000);
    f.edit(page.id, { task_status: "done" }); f.clock.now = (now + 1000) * 1000; await f.check(); assert.equal(f.delivered.length, 0);
    const id = "custom:" + randomUUID(), definition = { id, type: "minute" as const, name: "A", metadata: {} };
    f.knowledge.setDefinition(id, definition, "types"); f.edit(page.id, { task_status: "todo", [id]: now + 2000 });
    f.knowledge.timers.set(page.id, id, 0, true);
    f.knowledge.commitEdit({ pageId: page.id, tabId: "timers", batch: 0, blocks: [], detach: [id] });
    assert.equal(f.database.prepare("SELECT count(*) FROM timers WHERE attr_id=?").pluck().get(id), 0);
    f.edit(page.id, { [id]: now + 3000 }); f.knowledge.timers.set(page.id, id, 0, true);
    const next = { ...definition, type: "string" as const }, impact = f.knowledge.setDefinition(id, next, "types");
    if (impact) f.knowledge.setDefinition(id, next, "types", impact.token);
    assert.equal(f.database.prepare("SELECT count(*) FROM timers WHERE attr_id=?").pluck().get(id), 0);
});

test("a previously scheduled reminder catches up after reopening, is shared by windows and appears once", async t => {
    const f = fixture(t), due = Math.floor(f.clock.now / 1000) + 1000, page = f.knowledge.create("event", "A", { schedule_start: due });
    f.knowledge.timers.set(page.id, "schedule_start", 0, true); f.database.close(); f.clock.now = (due + 1) * 1000;
    const reopened = openWorkspace(f.info.path); t.after(() => reopened.database.close());
    const first = new KnowledgeService(reopened.db, () => f.clock.zone, () => f.clock.now), second = new KnowledgeService(reopened.db, () => f.clock.zone, () => f.clock.now), notices: Notice[] = [];
    await Promise.all([first.timers.check(notice => notices.push(notice)), second.timers.check(notice => notices.push(notice))]);
    assert.equal(notices.length, 1); assert.equal(notices[0].firedAt, due + 1);
    await second.timers.check(notice => notices.push(notice)); assert.equal(notices.length, 1);
});

test("notification identity and title are derived from the current page, with no undo entries for settings or reading", async t => {
    const f = fixture(t), due = Math.floor(f.clock.now / 1000) + 1000, page = f.knowledge.create("editable", "A"), id = "custom:" + randomUUID();
    f.knowledge.setDefinition(id, { id, name: "结束", type: "hour", metadata: {} }, "types"); f.edit(page.id, { [id]: due });
    const history = f.history.state("timers"); f.knowledge.timers.set(page.id, id, 0, true); assert.deepEqual(f.history.state("timers"), history);
    f.clock.now = due * 1000; await f.check();
    const notice = f.knowledge.timers.notices()[0]; assert.equal(notice.seen, false); assert.equal(notice.attrName, "结束");
    f.knowledge.timers.read(page.id, id, 0); assert.equal(f.knowledge.timers.notices()[0].seen, true);
    const title = page.blocks[page.titleBlockId]; f.knowledge.commitEdit({ pageId: page.id, tabId: "title", batch: 0, blocks: [{ ...title, payload: { ...title.payload, inline: [{ type: "text", text: "B" }] } }] });
    assert.equal(f.knowledge.timers.notices()[0].title, "B");
    const preview = f.knowledge.trash([page.id], "trash"); if (preview.status === "confirmation") f.knowledge.trash([page.id], "trash", preview.preview.token);
    assert.deepEqual(f.knowledge.timers.notices(), []);
});

test("unchanged writes, attribute renames and repeated enable requests preserve fired notifications", async t => {
    const f = fixture(t), due = Math.floor(f.clock.now / 1000) + 1000, page = f.knowledge.create("event", "A"), id = "custom:" + randomUUID();
    const definition = { id, name: "A", type: "minute" as const, metadata: {} };
    f.knowledge.setDefinition(id, definition, "types"); f.edit(page.id, { [id]: due }); f.knowledge.timers.set(page.id, id, 0, true);
    f.clock.now = due * 1000; await f.check();
    f.knowledge.timers.read(page.id, id, 0);
    f.knowledge.attributes.write(page.id, { [id]: due });
    assert.equal(f.knowledge.setDefinition(id, { ...definition, name: "B" }, "types"), null);
    f.knowledge.timers.set(page.id, id, 0, true);
    const notice = f.knowledge.timers.notices()[0];
    assert.equal(notice.attrName, "B"); assert.equal(notice.firedAt, due); assert.equal(notice.seen, true);
    await f.check(); assert.equal(f.delivered.length, 1);
});