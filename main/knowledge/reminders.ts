import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { notifications, reminderSchedules } from "../storage/tables";
import { KnowledgeService } from "./service";

import { type ReminderChange } from "./changes";

export class ReminderService {
    constructor(readonly knowledge: KnowledgeService) {}

    reconcile(changes: ReminderChange[]): void {
        const db = this.knowledge.db;
        for (const { pageId, before, after } of changes) {
            if (before.deleted === after.deleted && before.at === after.at && before.zone === after.zone) continue;
            db.update(reminderSchedules).set({ state: "disabled" }).where(and(eq(reminderSchedules.pageId, pageId), eq(reminderSchedules.state, "pending"))).run();
            if (!after.deleted && !before.deleted && after.at !== null) db.insert(reminderSchedules).values({ id: randomUUID(), pageId, scheduledAt: after.at, zone: after.zone ?? "UTC", state: "pending" }).run();
        }
    }

    due(nowMs = Date.now()): { id: string; pageId: string; title: string }[] {
        const db = this.knowledge.db;
        return db.$client.transaction(() => {
            const delivered: { id: string; pageId: string; title: string }[] = [];
            for (const schedule of db.select().from(reminderSchedules).where(and(eq(reminderSchedules.state, "pending"), lte(reminderSchedules.scheduledAt, Math.floor(nowMs / 1000)))).all()) {
                let page;
                try {
                    page = this.knowledge.get(schedule.pageId);
                }
                catch { /* Deleted or unavailable targets do not deliver. */ }
                if (!page || page.attributes.deleted || page.attributes.reminder_at !== schedule.scheduledAt || page.attributes.task_status === "done") {
                    db.update(reminderSchedules).set({ state: "disabled" }).where(eq(reminderSchedules.id, schedule.id)).run();
                    continue;
                }
                const notice = { id: randomUUID(), pageId: page.id, title: page.title || "未命名日程" };
                db.insert(notifications).values({ ...notice, scheduleId: schedule.id, createdAt: nowMs }).onConflictDoNothing().run();
                db.update(reminderSchedules).set({ state: "fired" }).where(eq(reminderSchedules.id, schedule.id)).run();
                delivered.push(notice);
            }
            return delivered;
        })();
    }
}