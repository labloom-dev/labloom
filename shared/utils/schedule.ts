import type { Schedule } from "../types/knowledge";

export function scheduleTime(value: string, timezone: string, endOfDay = false): number {
    if (!value) return Number.NaN;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value);
    const date = new Date(`${value}T00:00:00Z`);
    if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
    const desired = date.getTime();
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    let timestamp = desired;
    for (let attempt = 0; attempt < 4; attempt++) {
        const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value]));
        const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
        const next = timestamp + desired - local;
        if (next === timestamp) break;
        timestamp = next;
    }
    return timestamp - (endOfDay ? 1 : 0);
}

export function isOverdue(schedule: Schedule | null, now = Date.now()): boolean {
    return !!schedule && schedule.status !== "done" && !!schedule.end && scheduleTime(schedule.end, schedule.timezone, true) < now;
}

export function defaultSchedule(): Schedule {
    return { status: "todo", priority: "normal", start: "", end: "", allDay: false, reminder: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}


export function zonedInput(value: string, timezone: string): string {
    if (!value || value.length === 10) return value;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromZonedInput(value: string, timezone: string): string {
    if (!value || value.length === 10) return value;
    const desired = Date.parse(`${value}:00Z`);
    let timestamp = desired;
    for (let attempt = 0; attempt < 4; attempt++) {
        const displayed = Date.parse(`${zonedInput(new Date(timestamp).toISOString(), timezone)}:00Z`);
        timestamp += desired - displayed;
    }
    if (zonedInput(new Date(timestamp).toISOString(), timezone) !== value) throw new Error("该时区在这个时间切换夏令时，请选择有效时间。");
    return new Date(timestamp).toISOString();
}