import { recurrenceMinutes } from "../../shared/content/timers";
import { type AttributeValue } from "../../shared/types/attributes";
import { type WorkspaceDatabase } from "../storage/database";

export function reconcileFeedTimer(db: WorkspaceDatabase, pageId: string, values: Record<string, AttributeValue>, now: number, reset: boolean, restoring: boolean): void {
    if (values.deleted) return;
    const enabled = values.feed_status === "enabled" && values.feed_refresh !== null;
    if (!enabled) {
        db.$client.prepare("DELETE FROM timers WHERE page_id=? AND attr_id='feed_refresh'").run(pageId);
        return;
    }
    const interval = recurrenceMinutes(values.feed_refresh);
    if (interval === null) return;
    const previous = restoring ? db.$client.prepare("SELECT due_at FROM timers WHERE page_id=? AND attr_id='feed_refresh' AND lead_seconds=0").pluck().get(pageId) as number | null | undefined : null;
    const due = previous ?? (!reset && typeof values.feed_last_checked === "number" ? values.feed_last_checked + interval * 60 : now);
    db.$client.prepare(`INSERT INTO timers(page_id,attr_id,lead_seconds,due_at) VALUES (?,'feed_refresh',0,?)
        ON CONFLICT(page_id,attr_id,lead_seconds) DO UPDATE SET due_at=excluded.due_at,fired_at=NULL,seen=0`).run(pageId, Math.max(now, due));
}