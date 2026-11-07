import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { notifications, reminderSchedules } from "../storage/tables";
import { KnowledgeService, type StoredState } from "./service";

export class ReminderService {
    constructor(readonly knowledge: KnowledgeService) {}

    reconcile(before: StoredState, after: StoredState): void {
        const db = this.knowledge.db;
        for (const [key, value] of Object.entries(after)) {
            if (!value || !("page" in value) || !["task", "event"].includes(value.page.kind)) continue;
            const old = before[key];
            const attr = (state: typeof value | null | undefined, name: string): string | number | Buffer | null | undefined => state?.attrs.find(attr => attr.attrId === name)?.value;
            const previous = old && "page" in old ? old : null;
            const deleted = !!attr(value, "deleted"), oldDeleted = !!attr(previous, "deleted");
            const at = attr(value, "reminder_at"), zone = attr(value, "schedule_zone");
            if (deleted || oldDeleted || at !== attr(previous, "reminder_at") || zone !== attr(previous, "schedule_zone")) {
                db.update(reminderSchedules).set({ state: "disabled" }).where(and(eq(reminderSchedules.pageId, value.page.id), eq(reminderSchedules.state, "pending"))).run();
                if (!deleted && !oldDeleted && typeof at === "string") db.insert(reminderSchedules).values({ id: randomUUID(), pageId: value.page.id, scheduledAt: at, zone: String(zone ?? "UTC"), state: "pending" }).run();
            }
        }
    }

    due(now = new Date().toISOString()): { id: string; pageId: string; title: string }[] {
        const db = this.knowledge.db;
        return db.$client.transaction(() => {
            const delivered: { id: string; pageId: string; title: string }[] = [];
            for (const schedule of db.select().from(reminderSchedules).where(and(eq(reminderSchedules.state, "pending"), lte(reminderSchedules.scheduledAt, now))).all()) {
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
                db.insert(notifications).values({ ...notice, scheduleId: schedule.id, createdAt: now }).onConflictDoNothing().run();
                db.update(reminderSchedules).set({ state: "fired" }).where(eq(reminderSchedules.id, schedule.id)).run();
                delivered.push(notice);
            }
            return delivered;
        })();
    }
}