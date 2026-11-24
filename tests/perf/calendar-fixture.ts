import type Database from "better-sqlite3";
import { dayToSeconds } from "../../shared/content/time";
import { seedLibrary } from "./library-fixture";

const day = 86400;
const monthStart = dayToSeconds("2026-11-01");
const monthEnd = dayToSeconds("2026-12-01");
export const denseCalendarDay = dayToSeconds("2026-11-24");
const firstDay = dayToSeconds("2021-11-24");
const lastDay = dayToSeconds("2031-11-24");
const monthDays = (monthEnd - monthStart) / day;

// Seed an isolated workspace so the library and overview benchmarks keep their own data.
export function seedCalendar(sql: Database.Database): void {
    seedLibrary(sql);
    // Put the dense month on independent pages, even when the view hides dependent annotations.
    const pages = sql.prepare("SELECT id FROM pages ORDER BY kind='annotation', id").pluck().all() as string[];
    const attr = sql.prepare("INSERT INTO page_attrs(page_id,attr_id,value) VALUES(?,?,?)");
    const notice = sql.prepare("INSERT INTO timers(page_id,attr_id,fired_at,seen) VALUES(?,?,?,?)");
    let seed = 0x283d51a1, fired = 0;

    sql.transaction(() => {
        for (const [i, id] of pages.entries()) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            let date: number;
            if (i < 200) date = denseCalendarDay;
            else if (i < 600) {
                const offset = (i - 200) % (monthDays - 1);
                date = monthStart + offset * day;
                if (date >= denseCalendarDay) date += day;
            }
            else {
                // Concentrate dates near the dense month while still reaching five years in both directions.
                const wide = i % 3 === 0;
                const start = wide ? firstDay : monthStart - 365 * day;
                const end = wide ? lastDay : monthEnd + 365 * day;
                date = start + seed % ((end - start) / day + 1) * day;
                if (date >= monthStart && date < monthEnd) date += monthDays * day;
            }
            attr.run(id, "schedule_date", BigInt(date));
            const start = i % 3 === 0 ? null : date + (60 + seed % 600) * 60;
            if (start !== null) attr.run(id, "schedule_start", BigInt(start));
            const status = i % 5 === 0 ? null : i % 7 === 0 ? "done" : i % 2 === 0 ? "todo" : "doing";
            if (status !== null) attr.run(id, "task_status", status);
            if (fired < 400 && date < monthStart && status !== "done") {
                // Untimed reminders use 09:00 in the fixture's UTC+08:00 zone.
                notice.run(id, start === null ? "schedule_date" : "schedule_start", (start ?? date + 3600) + i % 37, fired % 2);
                fired++;
            }
        }
    })();
}