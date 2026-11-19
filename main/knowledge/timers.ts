import { display } from "../../shared/attrs/format";
import { isTimeType, resolveTimeZone } from "../../shared/content/time";
import { reminderDue } from "../../shared/content/timers";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import * as commit from "./commit";
import * as events from "./events";
import * as data from "./records";
import * as core from "./timer-state";

export { notices, settings } from "./timer-state";
export function set(pageId: string, attrId: string, leadSeconds: number, enabled: boolean): void {
    commit.run({ history: false, updateModified: false }, context => {
        core.set(pageId, attrId, leadSeconds, enabled);
        context.change({ pages: [pageId], notices: true });
    });
}
export function read(pageId: string, attrId: string, leadSeconds: number): void {
    commit.run({ history: false, updateModified: false }, context => {
        core.read(pageId, attrId, leadSeconds);
        context.change({ pages: [pageId], notices: true });
    });
}
export function recalculateAll(): void {
    commit.run({ history: false, updateModified: false }, context => {
        core.recalculateAll();
        context.change({ notices: true });
    });
}
type TimerRow = { pageId: string; attrId: string; leadSeconds: number; dueAt: number | null; firedAt: number | null; seen: number };
let running: Promise<string[]> | undefined;
export function release(): void {
    running = undefined;
}
/** Dispatch reminders once, then hand due subscriptions to the session scheduler. */
export function check(): Promise<string[]> {
    const session = workspace.requireWorkspace();
    if (running) return running;
    const pending = (async () => {
        if (!workspace.isCurrent(session)) return [];
        const now = workspace.seconds(), feeds: string[] = [];
        const due = data.statement("SELECT page_id AS pageId,attr_id AS attrId,lead_seconds AS leadSeconds,due_at AS dueAt,fired_at AS firedAt,seen FROM timers WHERE due_at<=? ORDER BY due_at,page_id,attr_id,lead_seconds").all(now) as TimerRow[];
        for (const row of due) {
            if (!workspace.isCurrent(session)) return [];
            const saved = data.statement("SELECT due_at FROM timers WHERE page_id=? AND attr_id=? AND lead_seconds=?").pluck().get(row.pageId, row.attrId, row.leadSeconds);
            if (saved !== row.dueAt) continue;
            const definition = attributes.definition(row.attrId), page = { ...data.header(row.pageId), attributes: data.valuesFor([row.pageId]).get(row.pageId)! };
            if (definition.type === "recurrence" && page.kind === "feed" && !page.attributes.deleted && page.attributes.feed_status === "enabled" && page.attributes.feed_refresh !== null) {
                feeds.push(row.pageId);
                continue;
            }
            commit.run({ history: false, updateModified: false }, context => {
                const expected = isTimeType(definition.type) ? reminderDue(definition.type, page.attributes[row.attrId] as number | null, row.leadSeconds, resolveTimeZone(workspace.timeZone())) : null;
                const allowed = isTimeType(definition.type) && !page.attributes.deleted && !core.completed(row.pageId) && expected === row.dueAt;
                const changed = data.statement("UPDATE timers SET due_at=NULL,fired_at=CASE WHEN ? THEN ? ELSE fired_at END,seen=CASE WHEN ? THEN 0 ELSE seen END WHERE page_id=? AND attr_id=? AND lead_seconds=? AND due_at=?")
                    .run(Number(allowed), now, Number(allowed), row.pageId, row.attrId, row.leadSeconds, row.dueAt).changes;
                context.change({ pages: [row.pageId], notices: true });
                if (allowed && changed) {
                    const notice = core.notice({ ...row, firedAt: now, seen: 0 });
                    const body = `${notice.title} · ${definition.name} ${display(definition, page.attributes[row.attrId], { zone: resolveTimeZone(workspace.timeZone()) })}`;
                    context.after(() => events.reminder(notice, body));
                }
                else if (!isTimeType(definition.type)) console.warn(`Unsupported timer attribute type: ${definition.type}`);
            });
        }
        return feeds;
    })().finally(() => {
        if (running === pending) running = undefined;
    });
    running = pending;
    return pending;
}