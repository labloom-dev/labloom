import { secondsPerDay as day, secondsToDay, secondsToSecond, startOfWeek, type TimePrecision } from "../content/time";
import type { GroupGranularity, QueryDate, RelativeDate } from "./query";

type Bounds = readonly [number, number];
const dateLimit = 8640000000000;

function utcDay(seconds: number): number {
    return Math.floor(seconds / day) * day;
}

function addMonths(seconds: number, amount: number): number {
    const date = new Date(seconds * 1000);
    date.setUTCMonth(date.getUTCMonth() + amount, 1);
    return date.getTime() / 1000;
}

function civilDay(seconds: number, zone: string): number {
    return zone === "UTC" ? utcDay(seconds) : Date.parse(secondsToDay(seconds, zone) + "T00:00:00Z") / 1000;
}

// A local date can begin after midnight or be skipped when the offset changes.
function zonedStart(date: number, zone: string): number {
    if (zone === "UTC" || Math.abs(date) >= dateLimit) return date;
    let low = Math.max(-dateLimit, date - 2 * day), high = Math.min(dateLimit, date + 2 * day);
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (civilDay(mid, zone) < date) low = mid + 1;
        else high = mid;
    }
    return low;
}

function calendarStart(date: number, unit: GroupGranularity): number {
    if (unit === "day") return utcDay(date);
    if (unit === "week") return startOfWeek(utcDay(date));
    const value = new Date(date * 1000);
    value.setUTCMonth(unit === "year" ? 0 : value.getUTCMonth(), 1);
    value.setUTCHours(0, 0, 0, 0);
    return value.getTime() / 1000;
}

function nextPeriod(start: number, unit: GroupGranularity): number {
    return unit === "year" ? addMonths(start, 12) : unit === "month" ? addMonths(start, 1) : start + (unit === "week" ? 7 : 1) * day;
}

function relativeBounds(value: RelativeDate, today: number): Bounds {
    switch (value.period) {
        case "today": return [today, today + day];
        case "yesterday": return [today - day, today];
        case "tomorrow": return [today + day, today + 2 * day];
        case "past-days": return [Math.max(-dateLimit, today - (value.days - 1) * day), today + day];
        case "next-days": return [today, Math.min(dateLimit, today + value.days * day)];
        case "this-week": case "last-week": case "next-week": {
            const start = startOfWeek(today) + (value.period === "last-week" ? -7 : value.period === "next-week" ? 7 : 0) * day;
            return [start, start + 7 * day];
        }
        case "this-month": case "last-month": case "next-month": {
            const start = addMonths(today, value.period === "last-month" ? -1 : value.period === "next-month" ? 1 : 0);
            return [start, addMonths(start, 1)];
        }
    }
}

export function dateBounds(value: QueryDate, precision: TimePrecision, zone: string, now: number): Bounds {
    const timed = precision === "minute" || precision === "hour";
    if (value.kind === "absolute") {
        if (!timed) {
            const end = nextPeriod(value.seconds, precision);
            return [value.seconds, Number.isFinite(end) ? end : dateLimit + 1];
        }
        const local = secondsToSecond(value.seconds, zone);
        const start = value.seconds - Number(local.slice(-2)) - (precision === "hour" ? Number(local.slice(-5, -3)) * 60 : 0);
        return [start, start + (precision === "hour" ? 3600 : 60)];
    }
    const [from, to] = relativeBounds(value, civilDay(now, zone));
    if (timed) return [zonedStart(from, zone), zonedStart(to, zone)];
    if (precision === "day") return [from, to];
    const start = calendarStart(from, precision), end = nextPeriod(calendarStart(to - day, precision), precision);
    return [Number.isFinite(start) ? start : -dateLimit, Number.isFinite(end) ? end : dateLimit + 1];
}

export function dateGroup(value: number, precision: TimePrecision, granularity: GroupGranularity, zone: string): number {
    return calendarStart(civilDay(value, precision === "minute" || precision === "hour" ? zone : "UTC"), granularity);
}

export function groupDateValue(start: number, precision: TimePrecision, granularity: GroupGranularity, zone: string): number {
    if (precision === "minute" || precision === "hour") return zonedStart(start, zone);
    const unit = calendarStart(start, precision), after = nextPeriod(unit, precision);
    return unit < start && after < nextPeriod(start, granularity) ? after : unit;
}