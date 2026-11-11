import { type AttributeValue } from "../types/attributes";

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

export function secondsToWall(seconds: number, zone?: string): string {
    let formatter = formatters.get(zone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
        formatters.set(zone, formatter);
    }
    return formatter.format(seconds * 1000).replace(" ", "T");
}

export function scheduleDay(attributes: Record<string, AttributeValue>, zone: string): string {
    if (typeof attributes.schedule_start === "number") return secondsToWall(attributes.schedule_start, zone).slice(0, 10);
    return typeof attributes.schedule_date === "string" ? attributes.schedule_date : "";
}

export function wallToSeconds(wall: string, zone: string): number {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) throw new Error("请输入完整日期和时间。");
    const reference = Date.parse(`${wall}:00.000Z`) / 1000;
    if (!Number.isFinite(reference)) throw new Error("日期和时间无效。");
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
    if (!candidates.size) throw new Error("该时区不存在这个本地时间，请避开夏令时跳变时间。");
    if (candidates.size > 1) throw new Error("此时间在夏令时切换时出现两次。请暂将时区设为 UTC 后输入明确时间。");
    return [...candidates][0];
}