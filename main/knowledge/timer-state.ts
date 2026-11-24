import { isTimeType, resolveTimeZone } from "../../shared/content/time";
import { reminderDue } from "../../shared/content/timers";
import { LabloomError } from "../../shared/failure";
import { type Notice } from "../../shared/types/knowledge";
import { reconcileFeedTimer } from "../feed/schedule";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import * as data from "./records";

type TimerRow = { pageId: string; attrId: string; leadSeconds: number; dueAt: number | null; firedAt: number | null; seen: number };
const columns = "page_id AS pageId,attr_id AS attrId,lead_seconds AS leadSeconds,due_at AS dueAt,fired_at AS firedAt,seen";
function now(): number {
    return Math.floor(workspace.clock() / 1000);
}

export function settings(pageId: string): Record<string, number[]> {
    data.header(pageId);
    const result: Record<string, number[]> = {};
    for (const row of data.statement("SELECT attr_id AS attrId,lead_seconds AS leadSeconds FROM timers WHERE page_id=? ORDER BY lead_seconds").all(pageId) as TimerRow[]) {
        if (isTimeType(attributes.definition(row.attrId).type)) (result[row.attrId] ??= []).push(row.leadSeconds);
    }
    return result;
}

export function set(pageId: string, attrId: string, leadSeconds: number, enabled: boolean): void {
    if (!Number.isSafeInteger(leadSeconds) || leadSeconds < 0 || typeof enabled !== "boolean") throw new LabloomError({ kind: "timer-invalid-settings" });
    data.writable(pageId);
    const definition = attributes.definition(attrId);
    if (!isTimeType(definition.type)) throw new LabloomError({ kind: "timer-attribute-unavailable" });
    if (!data.statement("SELECT 1 FROM page_attrs WHERE page_id=? AND attr_id=?").get(pageId, attrId)) throw new LabloomError({ kind: "timer-attribute-missing" });
    workspace.native().transaction(() => {
        if (!enabled) data.statement("DELETE FROM timers WHERE page_id=? AND attr_id=? AND lead_seconds=?").run(pageId, attrId, leadSeconds);
        else {
            const inserted = data.statement("INSERT OR IGNORE INTO timers(page_id,attr_id,lead_seconds) VALUES (?,?,?)").run(pageId, attrId, leadSeconds);
            if (inserted.changes) recalculate(pageId, [attrId], leadSeconds);
        }
    })();
}

export function completed(pageId: string): boolean {
    return !!data.statement(`SELECT 1 FROM page_attrs v JOIN attrs_meta a ON a.id=v.attr_id, json_each(a.metadata,'$.options') o
        WHERE v.page_id=? AND a.type='status' AND o.value->>'$.id'=v.value AND o.value->>'$.group'='complete' LIMIT 1`).get(pageId);
}

export function recalculate(pageId: string, fields?: string[], leadOnly?: number): void {
    const all = !fields || fields.includes("deleted") || fields.some(id => data.statement("SELECT 1 FROM attrs_meta WHERE id=? AND type='status'").get(id));
    const feedChange = fields?.some(id => ["feed_url", "feed_status", "feed_refresh", "deleted"].includes(id));
    const rows = data.statement(`SELECT ${columns} FROM timers WHERE page_id=?` + (all ? "" : " AND attr_id IN (SELECT value FROM json_each(?))")).all(...(all ? [pageId] : [pageId, JSON.stringify(fields)])) as TimerRow[];
    if (!rows.length && !feedChange) return;
    const page = { ...data.header(pageId), attributes: data.valuesFor([pageId]).get(pageId)! };
    const muted = page.attributes.deleted || completed(pageId);
    for (const row of rows) {
        const definition = attributes.definition(row.attrId);
        if (!isTimeType(definition.type)) {
            if (row.attrId !== "feed_refresh" || page.kind !== "feed" || definition.type !== "recurrence") data.statement("DELETE FROM timers WHERE page_id=? AND attr_id=?").run(pageId, row.attrId);
            continue;
        }
        if (leadOnly !== undefined && row.leadSeconds !== leadOnly) continue;
        const due = muted ? null
            : reminderDue(definition.type, page.attributes[row.attrId] as number | null, row.leadSeconds, resolveTimeZone(workspace.timeZone()));
        data.statement("UPDATE timers SET due_at=?,fired_at=NULL,seen=0 WHERE page_id=? AND attr_id=? AND lead_seconds=?")
            .run(due !== null && due > now() ? due : null, pageId, row.attrId, row.leadSeconds);
    }
    if (page.kind === "feed" && fields && feedChange) reconcileFeedTimer(workspace.database(), pageId, page.attributes, now(),
        fields.some(id => id === "feed_url" || id === "feed_status"), fields.includes("deleted") && !page.attributes.deleted);
}

export function recalculateAll(): void {
    workspace.native().transaction(() => {
        for (const id of data.statement("SELECT DISTINCT page_id FROM timers").pluck().all() as string[]) recalculate(id);
    })();
}

export function notices(): Notice[] {

    return (data.statement(`SELECT t.${columns.replaceAll(",", ",t.")} FROM timers t JOIN page_attrs d ON d.page_id=t.page_id AND d.attr_id='deleted'
        WHERE t.fired_at IS NOT NULL AND d.value=0 ORDER BY t.fired_at DESC,t.page_id,t.attr_id,t.lead_seconds`).all() as TimerRow[]).map(row => notice(row));
}

export function notice(row: TimerRow): Notice {
    return {
        pageId: row.pageId, attrId: row.attrId, leadSeconds: row.leadSeconds, title: data.title(row.pageId),
        attrName: attributes.definition(row.attrId).name, firedAt: row.firedAt!, seen: !!row.seen
    };
}

export function read(pageId: string, attrId: string, leadSeconds: number): void {
    if (!Number.isSafeInteger(leadSeconds) || leadSeconds < 0) throw new LabloomError({ kind: "timer-invalid-notice" });
    data.writable(pageId);
    data.statement("UPDATE timers SET seen=1 WHERE page_id=? AND attr_id=? AND lead_seconds=?").run(pageId, attrId, leadSeconds);
}