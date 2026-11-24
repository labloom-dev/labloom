import { isTimeType, resolveTimeZone, type TimePrecision } from "../../shared/content/time";
import { reminderDue } from "../../shared/content/timers";
import { LabloomError } from "../../shared/failure";
import type { AttributeDefinition } from "../../shared/types/attributes";
import { type Notice, type NoticeKey } from "../../shared/types/knowledge";
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

export function recalculate(pageId: string, fields?: string[], leadOnly?: number): boolean {
    const all = !fields || fields.includes("deleted") || fields.some(id => data.statement("SELECT 1 FROM attrs_meta WHERE id=? AND type='status'").get(id));
    const feedChange = fields?.some(id => ["feed_url", "feed_status", "feed_refresh", "deleted"].includes(id));
    const rows = data.statement(`SELECT ${columns} FROM timers WHERE page_id=?` + (all ? "" : " AND attr_id IN (SELECT value FROM json_each(?))")).all(...(all ? [pageId] : [pageId, JSON.stringify(fields)])) as TimerRow[];
    if (!rows.length && !feedChange) return false;
    const page = { ...data.header(pageId), attributes: data.valuesFor([pageId]).get(pageId)! };
    const muted = page.attributes.deleted || completed(pageId);
    let noticesChanged = false;
    for (const row of rows) {
        const definition = attributes.definition(row.attrId);
        if (!isTimeType(definition.type)) {
            if (row.attrId !== "feed_refresh" || page.kind !== "feed" || definition.type !== "recurrence") {
                data.statement("DELETE FROM timers WHERE page_id=? AND attr_id=?").run(pageId, row.attrId);
                noticesChanged ||= row.firedAt !== null;
            }
            continue;
        }
        if (leadOnly !== undefined && row.leadSeconds !== leadOnly) continue;
        const due = muted ? null
            : reminderDue(definition.type, page.attributes[row.attrId] as number | null, row.leadSeconds, resolveTimeZone(workspace.timeZone()));
        data.statement("UPDATE timers SET due_at=?,fired_at=NULL,seen=0 WHERE page_id=? AND attr_id=? AND lead_seconds=?")
            .run(due !== null && due > now() ? due : null, pageId, row.attrId, row.leadSeconds);
        noticesChanged ||= row.firedAt !== null;
    }
    if (page.kind === "feed" && fields && feedChange) reconcileFeedTimer(workspace.database(), pageId, page.attributes, now(),
        fields.some(id => id === "feed_url" || id === "feed_status"), fields.includes("deleted") && !page.attributes.deleted);
    return noticesChanged;
}

export function recalculateAll(): void {
    workspace.native().transaction(() => {
        for (const id of data.statement("SELECT DISTINCT page_id FROM timers").pluck().all() as string[]) recalculate(id);
    })();
}

export function notices(): Notice[] {
    const rows = data.statement(`SELECT t.page_id AS pageId,t.attr_id AS attrId,t.lead_seconds AS leadSeconds,
        t.fired_at AS firedAt,t.seen,knowledge_text(b.type,b.content) AS title,
        coalesce(a.name,a.id) AS attrName,a.type AS attrType,v.value AS attrValue
        FROM timers t JOIN page_attrs d ON d.page_id=t.page_id AND d.attr_id='deleted' AND d.value=0
        JOIN pages p ON p.id=t.page_id JOIN blocks b ON b.id=p.title_block_id
        JOIN attrs_meta a ON a.id=t.attr_id JOIN page_attrs v ON v.page_id=t.page_id AND v.attr_id=t.attr_id
        WHERE t.fired_at IS NOT NULL ORDER BY t.fired_at DESC,t.page_id,t.attr_id,t.lead_seconds`).all() as (Omit<Notice, "seen"> & { seen: number })[];
    return rows.filter(row => isTimeType(row.attrType)).map(row => ({ ...row, seen: !!row.seen }));
}

export function notice(row: TimerRow, definition: AttributeDefinition & { type: TimePrecision }, value: number | null): Notice {
    return {
        pageId: row.pageId, attrId: row.attrId, leadSeconds: row.leadSeconds, title: data.title(row.pageId, ""),
        attrName: definition.name, attrType: definition.type, attrValue: value, firedAt: row.firedAt!, seen: !!row.seen
    };
}

export function unreadCount(): number {
    return Number(data.statement(`SELECT count(*) FROM timers t JOIN page_attrs d ON d.page_id=t.page_id AND d.attr_id='deleted' AND d.value=0
        WHERE t.fired_at IS NOT NULL AND t.seen=0`).pluck().get());
}

export function updateNotice(action: "read" | "unread" | "clear", { pageId, attrId, leadSeconds, firedAt }: Omit<NoticeKey, "firedAt"> & { firedAt?: number }): number {
    if (!Number.isSafeInteger(leadSeconds) || leadSeconds < 0 || firedAt !== undefined && !Number.isSafeInteger(firedAt)) {
        throw new LabloomError({ kind: "timer-invalid-notice" });
    }
    data.writable(pageId);
    const writes = { read: "seen=1", unread: "seen=0", clear: "fired_at=NULL,seen=0" };
    return data.statement(`UPDATE timers SET ${writes[action]} WHERE page_id=? AND attr_id=? AND lead_seconds=?
        AND fired_at IS NOT NULL AND (? IS NULL OR fired_at=?)`).run(pageId, attrId, leadSeconds, firedAt ?? null, firedAt ?? null).changes;
}

export function updateAllNotices(clear: boolean): number {
    return clear
        ? data.statement("UPDATE timers SET fired_at=NULL,seen=0 WHERE fired_at IS NOT NULL").run().changes
        : data.statement("UPDATE timers SET seen=1 WHERE fired_at IS NOT NULL AND seen=0").run().changes;
}