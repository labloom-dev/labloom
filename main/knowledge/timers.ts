import { LabloomError } from "../../shared/failure";
import { display } from "../../shared/attrs/format";
import { isTimeType, resolveTimeZone } from "../../shared/content/time";
import { reminderDue } from "../../shared/content/timers";
import { type Notice } from "../../shared/types/knowledge";
import { reconcileFeedTimer } from "../feed/schedule";
import { type KnowledgeRecords } from "./records";

type TimerRow = { pageId: string; attrId: string; leadSeconds: number; dueAt: number | null; firedAt: number | null; seen: number };
const columns = "page_id AS pageId,attr_id AS attrId,lead_seconds AS leadSeconds,due_at AS dueAt,fired_at AS firedAt,seen";
const running = new WeakMap<object, Promise<void>>();

export class TimerService {
    constructor(readonly knowledge: KnowledgeRecords, private readonly zone: () => string = () => "system", private readonly clock: () => number = Date.now) {}
    private now(): number {
 return Math.floor(this.clock() / 1000);
}
    settings(pageId: string): Record<string, number[]> {
        this.knowledge.header(pageId);
        const result: Record<string, number[]> = {};
        for (const row of this.knowledge.statement("SELECT attr_id AS attrId,lead_seconds AS leadSeconds FROM timers WHERE page_id=? ORDER BY lead_seconds").all(pageId) as TimerRow[]) {
            if (isTimeType(this.knowledge.attributes.definition(row.attrId).type)) (result[row.attrId] ??= []).push(row.leadSeconds);
        }
        return result;
    }
    set(pageId: string, attrId: string, leadSeconds: number, enabled: boolean): void {
        if (!Number.isSafeInteger(leadSeconds) || leadSeconds < 0 || typeof enabled !== "boolean") throw new LabloomError({ kind: "timer-invalid-settings" });
        const definition = this.knowledge.attributes.definition(attrId);
        if (!isTimeType(definition.type) || this.knowledge.flags(pageId).deleted) throw new LabloomError({ kind: "timer-attribute-unavailable" });
        if (!this.knowledge.statement("SELECT 1 FROM page_attrs WHERE page_id=? AND attr_id=?").get(pageId, attrId)) throw new LabloomError({ kind: "timer-attribute-missing" });
        this.knowledge.sql.transaction(() => {
            if (!enabled) this.knowledge.statement("DELETE FROM timers WHERE page_id=? AND attr_id=? AND lead_seconds=?").run(pageId, attrId, leadSeconds);
            else {
                const inserted = this.knowledge.statement("INSERT OR IGNORE INTO timers(page_id,attr_id,lead_seconds) VALUES (?,?,?)").run(pageId, attrId, leadSeconds);
                if (inserted.changes) this.recalculate(pageId, [attrId], leadSeconds);
            }
        })();
    }
    recalculate(pageId: string, fields?: string[], leadOnly?: number): void {
        const data = this.knowledge, all = !fields || fields.some(id => ["deleted", "task_status"].includes(id));
        const feedChange = fields?.some(id => ["feed_url", "feed_status", "feed_refresh", "deleted"].includes(id));
        const rows = data.statement(`SELECT ${columns} FROM timers WHERE page_id=?` + (all ? "" : " AND attr_id IN (SELECT value FROM json_each(?))")).all(...(all ? [pageId] : [pageId, JSON.stringify(fields)])) as TimerRow[];
        if (!rows.length && !feedChange) return;
        const page = { ...data.header(pageId), attributes: data.valuesFor([pageId]).get(pageId)! };
        for (const row of rows) {
            const definition = data.attributes.definition(row.attrId);
            if (!isTimeType(definition.type)) {
                if (row.attrId !== "feed_refresh" || page.kind !== "feed" || definition.type !== "recurrence") data.statement("DELETE FROM timers WHERE page_id=? AND attr_id=?").run(pageId, row.attrId);
                continue;
            }
            if (!all && !fields!.includes(row.attrId) || leadOnly !== undefined && row.leadSeconds !== leadOnly) continue;
            const due = page.attributes.deleted || page.kind === "task" && page.attributes.task_status === "done" ? null
                : reminderDue(definition.type, page.attributes[row.attrId] as number | null, row.leadSeconds, resolveTimeZone(this.zone()));
            data.statement("UPDATE timers SET due_at=?,fired_at=NULL,seen=0 WHERE page_id=? AND attr_id=? AND lead_seconds=?")
                .run(due !== null && due > this.now() ? due : null, pageId, row.attrId, row.leadSeconds);
        }
        if (page.kind === "feed" && fields?.some(id => ["deleted", "feed_url", "feed_status", "feed_refresh"].includes(id))) reconcileFeedTimer(data.db, pageId, page.attributes, this.now(), fields.some(id => ["deleted", "feed_url", "feed_status"].includes(id)));
    }
    recalculateAll(): void {
        this.knowledge.sql.transaction(() => {
            for (const id of this.knowledge.statement("SELECT DISTINCT page_id FROM timers").pluck().all() as string[]) this.recalculate(id);
        })();
    }
    notices(): Notice[] {
        const data = this.knowledge;
        return (data.statement(`SELECT t.${columns.replaceAll(",", ",t.")} FROM timers t JOIN page_attrs d ON d.page_id=t.page_id AND d.attr_id='deleted'
            WHERE t.fired_at IS NOT NULL AND d.value=0 ORDER BY t.fired_at DESC,t.page_id,t.attr_id,t.lead_seconds LIMIT 100`).all() as TimerRow[]).map(row => this.notice(row));
    }
    private notice(row: TimerRow): Notice {
        return { pageId: row.pageId, attrId: row.attrId, leadSeconds: row.leadSeconds, title: this.knowledge.title(row.pageId),
            attrName: this.knowledge.attributes.definition(row.attrId).name, firedAt: row.firedAt!, seen: !!row.seen };
    }
    read(pageId: string, attrId: string, leadSeconds: number): void {
        if (!Number.isSafeInteger(leadSeconds) || leadSeconds < 0) throw new LabloomError({ kind: "timer-invalid-notice" });
        this.knowledge.statement("UPDATE timers SET seen=1 WHERE page_id=? AND attr_id=? AND lead_seconds=?").run(pageId, attrId, leadSeconds);
    }
    check(deliver: (notice: Notice, body: string) => void, refresh?: (pageId: string) => Promise<void>): Promise<void> {
        if (running.has(this.knowledge.sql)) return running.get(this.knowledge.sql)!;
        const action = async (): Promise<void> => {
            const data = this.knowledge, now = this.now();
            const due = data.statement(`SELECT ${columns} FROM timers WHERE due_at<=? ORDER BY due_at,page_id,attr_id,lead_seconds`).all(now) as TimerRow[];
            for (const row of due) {
                if (!data.sql.open) return;
                const saved = data.statement("SELECT due_at FROM timers WHERE page_id=? AND attr_id=? AND lead_seconds=?").pluck().get(row.pageId, row.attrId, row.leadSeconds);
                if (saved !== row.dueAt) continue;
                const definition = data.attributes.definition(row.attrId), page = { ...data.header(row.pageId), attributes: data.valuesFor([row.pageId]).get(row.pageId)! };
                if (definition.type === "recurrence" && page.kind === "feed" && refresh) {
                    if (!page.attributes.deleted && page.attributes.feed_status === "enabled" && page.attributes.feed_refresh !== null) await refresh(row.pageId);
                    else data.statement("UPDATE timers SET due_at=NULL WHERE page_id=? AND attr_id=? AND lead_seconds=?").run(row.pageId, row.attrId, row.leadSeconds);
                    continue;
                }
                let notice: Notice | undefined, body = "";
                data.sql.transaction(() => {
                    const expected = isTimeType(definition.type) ? reminderDue(definition.type, page.attributes[row.attrId] as number | null, row.leadSeconds, resolveTimeZone(this.zone())) : null;
                    const allowed = isTimeType(definition.type) && !page.attributes.deleted && !(page.kind === "task" && page.attributes.task_status === "done") && expected === row.dueAt;
                    const changed = data.statement("UPDATE timers SET due_at=NULL,fired_at=CASE WHEN ? THEN ? ELSE fired_at END,seen=CASE WHEN ? THEN 0 ELSE seen END WHERE page_id=? AND attr_id=? AND lead_seconds=? AND due_at=?")
                        .run(Number(allowed), now, Number(allowed), row.pageId, row.attrId, row.leadSeconds, row.dueAt).changes;
                    if (allowed && changed) {
                        notice = this.notice({ ...row, firedAt: now, seen: 0 });
                        body = `${notice.title} · ${definition.name} ${display(definition, page.attributes[row.attrId], { zone: resolveTimeZone(this.zone()) })}`;
                    }
                    else if (!isTimeType(definition.type)) console.warn(`Unsupported timer attribute type: ${definition.type}`);
                })();
                if (notice) deliver(notice, body);
            }
        };
        const pending = Promise.resolve().then(action).finally(() => running.delete(this.knowledge.sql));
        running.set(this.knowledge.sql, pending);
        return pending;
    }
}