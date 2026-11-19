import type { AttributeValue } from "../../../shared/types/attributes";
import { secondsToDay } from "../../../shared/content/time";

export function scheduleDay(attributes: Record<string, AttributeValue>, dateId: string): string {
    const date = attributes[dateId];
    return typeof date === "number" ? secondsToDay(date) : "";
}