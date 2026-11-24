import { LabloomError } from "../failure";
import { type AttributeType } from "../types/attributes";

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export function resolveTimeZone(preference: string): string {
    return preference === "system" ? Intl.DateTimeFormat().resolvedOptions().timeZone : preference;
}

export function validTimeZone(preference: unknown): preference is string {
    if (preference === "system") return true;
    if (typeof preference !== "string" || !/^[A-Za-z]/.test(preference)) return false;
    try {
        new Intl.DateTimeFormat("en", { timeZone: preference });
        return true;
    }
    catch {
        return false;
    }
}

const formatters = new Map<string | undefined, Intl.DateTimeFormat>();

export function secondsToSecond(seconds: number, zone?: string): string {
    let formatter = formatters.get(zone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: zone, calendar: "iso8601", numberingSystem: "latn", era: "short",
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
        });
        formatters.set(zone, formatter);
    }
    const { year, month, day, hour, minute, second, era } = Object.fromEntries(formatter.formatToParts(seconds * 1000).map(({ type, value }) => [type, value]));
    const isoYear = era === "BC" ? 1 - Number(year) : Number(year);
    const yyyy = isoYear >= 0 && isoYear <= 9999 ? String(isoYear).padStart(4, "0")
        : (isoYear < 0 ? "-" : "+") + String(Math.abs(isoYear)).padStart(6, "0");
    return yyyy + "-" + month + "-" + day + " " + hour + ":" + minute + ":" + second;
}

export function secondsToMinute(seconds: number, zone?: string): string {
    return secondsToSecond(seconds, zone).slice(0, -3);
}

export function secondsToHour(seconds: number, zone?: string): string {
    return secondsToSecond(seconds, zone).slice(0, -6) + ":00";
}

export function secondsToWall(seconds: number, zone?: string): string {
    return secondsToMinute(seconds, zone).replace(" ", "T");
}

export function wallToSeconds(wall: string, zone: string): number {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) throw new LabloomError({ kind: "time-incomplete" });
    const reference = dayToSeconds(wall.slice(0, 10)) + Number(wall.slice(11, 13)) * 3600 + Number(wall.slice(14)) * 60;
    if (Number(wall.slice(11, 13)) > 23 || Number(wall.slice(14)) > 59) throw new LabloomError({ kind: "time-invalid" });
    let guess = reference;
    for (let i = 0; i < 4; i++) {
        const offset = reference - Date.parse(`${secondsToWall(guess, zone)}:00.000Z`) / 1000;
        if (!offset) break;
        guess += offset;
    }
    const candidates = new Set<number>();
    for (let delta = -180; delta <= 180; delta += 30) {
        const candidate = guess + delta * 60;
        if (secondsToWall(candidate, zone) === wall) candidates.add(candidate);
    }
    if (!candidates.size) throw new LabloomError({ kind: "time-dst-gap" });
    if (candidates.size > 1) throw new LabloomError({ kind: "time-dst-overlap" });
    return [...candidates][0];
}

export const timeTypes = ["minute", "hour", "day", "month", "year"] as const;
export type TimePrecision = typeof timeTypes[number];

export function isTimeType(type: AttributeType): type is TimePrecision {
    return (timeTypes as readonly string[]).includes(type);
}

export function validTimeSeconds(type: TimePrecision, value: unknown): value is number {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime())) return false;
    if (type === "minute" || type === "hour") return true;
    if (date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds()) return false;
    if (type === "day") return true;
    if (date.getUTCDate() !== 1) return false;
    return type === "month" || date.getUTCMonth() === 0;
}

export function secondsToDay(seconds: number, zone = "UTC"): string {
    if (zone !== "UTC") return secondsToSecond(seconds, zone).slice(0, -9);
    return new Date(seconds * 1000).toISOString().split("T")[0];
}

export function dayToSeconds(day: string): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new LabloomError({ kind: "time-incomplete-day" });
    const seconds = Date.parse(`${day}T00:00:00Z`) / 1000;
    if (!Number.isFinite(seconds) || secondsToDay(seconds) !== day) throw new LabloomError({ kind: "time-invalid-day" });
    return seconds;
}

export function secondsToMonth(seconds: number): string {
    return secondsToDay(seconds).slice(0, -3);
}

export function monthToSeconds(month: string): number {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new LabloomError({ kind: "time-incomplete-month" });
    return dayToSeconds(`${month}-01`);
}

export function secondsToYear(seconds: number): string {
    return secondsToMonth(seconds).slice(0, -3);
}

export function yearToSeconds(year: string): number {
    if (!/^\d{4}$/.test(year)) throw new LabloomError({ kind: "time-incomplete-year" });
    return dayToSeconds(`${year}-01-01`);
}

export function timeToSeconds(type: TimePrecision, text: string, zone: string): number {
    switch (type) {
        case "day": return dayToSeconds(text);
        case "month": return monthToSeconds(text);
        case "year": return yearToSeconds(text);
        case "minute": return wallToSeconds(text.replace(" ", "T"), zone);
        case "hour": {
            if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}(?:时|:00)?$/.test(text)) throw new LabloomError({ kind: "time-incomplete-hour" });
            return wallToSeconds(text.slice(0, 13).replace(" ", "T") + ":00", zone);
        }
    }
}