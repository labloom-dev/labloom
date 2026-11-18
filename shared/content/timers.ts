import { secondsToDay, wallToSeconds, type TimePrecision } from "./time";
import { type AttributeValue } from "../types/attributes";

export function reminderDue(type: TimePrecision, value: number | null, leadSeconds: number, zone: string): number | null {
    if (value === null) return null;
    return (type === "minute" || type === "hour" ? value : wallToSeconds(secondsToDay(value) + "T09:00", zone)) - leadSeconds;
}

export function recurrenceMinutes(value: AttributeValue): number | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const unit = { minute: 1, hour: 60, day: 1440, week: 10080, month: 43200 }[String(value.unit)];
    return unit && typeof value.every === "number" ? unit * value.every : null;
}