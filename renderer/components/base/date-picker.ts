import {
    dayToSeconds, secondsToDay, secondsToHour, secondsToMinute, secondsToMonth, secondsToYear, type TimePrecision
} from "../../../shared/content/time";

const day = 86400;
const firstDay = dayToSeconds("0000-01-01"), lastDay = dayToSeconds("9999-12-31");
export const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function utcDay(year: number, month = 0, date = 1): number {
    const value = new Date(0);
    return value.setUTCFullYear(year, month, date) / 1000;
}

export function clampPickerDay(date: number): number {
    return Math.max(firstDay, Math.min(lastDay, date));
}

export function pickerDay(precision: TimePrecision, date: number): number {
    const value = new Date(date * 1000);
    if (precision === "year") return utcDay(value.getUTCFullYear());
    if (precision === "month") return utcDay(value.getUTCFullYear(), value.getUTCMonth());
    return date;
}

export function movePickerDay(precision: TimePrecision, date: number, steps: number): number {
    const value = new Date(date * 1000), year = value.getUTCFullYear(), month = value.getUTCMonth();
    if (precision === "year") return pickerDay(precision, clampPickerDay(utcDay(year + steps)));
    if (precision === "month") return pickerDay(precision, clampPickerDay(utcDay(year, month + steps)));
    return clampPickerDay(date + steps * day);
}

export function shiftPickerPage(precision: TimePrecision, date: number, steps: number): number {
    if (precision === "year" || precision === "month") return movePickerDay(precision, date, steps * 12);
    const value = new Date(date * 1000), year = value.getUTCFullYear(), month = value.getUTCMonth() + steps;
    const end = new Date(utcDay(year, month + 1, 0) * 1000).getUTCDate();
    return clampPickerDay(utcDay(year, month, Math.min(end, value.getUTCDate())));
}

export function pickerPageStart(precision: TimePrecision, date: number): number {
    const year = new Date(date * 1000).getUTCFullYear();
    if (precision === "year") return utcDay(Math.floor(year / 12) * 12);
    if (precision === "month") return utcDay(year);
    return pickerDay("month", date);
}

export function pickerRows(precision: TimePrecision, start: number): (number | null)[][] {
    const first = new Date(start * 1000), year = first.getUTCFullYear();
    const monday = start - ((first.getUTCDay() + 6) % 7) * day;
    const columns = precision === "year" || precision === "month" ? 3 : 7;
    return Array.from({ length: columns === 3 ? 4 : 6 }, (_, row) => Array.from({ length: columns }, (_, column) => {
        const i = row * columns + column;
        const value = precision === "year" ? utcDay(year + i) : precision === "month" ? utcDay(year, i) : monday + i * day;
        return value === clampPickerDay(value) ? value : null;
    }));
}

export function pickerHeading(precision: TimePrecision, start: number): string {
    if (precision === "year") return secondsToYear(start) + "–" + secondsToYear(movePickerDay(precision, start, 11));
    if (precision === "month") return secondsToYear(start);
    return secondsToMonth(start);
}

export function pickerValueText(precision: TimePrecision, value: number, zone: string): string {
    switch (precision) {
        case "minute": return secondsToMinute(value, zone);
        case "hour": return secondsToHour(value, zone);
        case "day": return secondsToDay(value);
        case "month": return secondsToMonth(value);
        case "year": return secondsToYear(value);
    }
}