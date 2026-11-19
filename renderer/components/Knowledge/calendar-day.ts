import type { AttributeValue } from "../../../shared/types/attributes";
import { secondsToDay, secondsToWall } from "../../../shared/content/time";

export function scheduleDay(attributes: Record<string, AttributeValue>, zone: string): string {
    if (typeof attributes.schedule_start === "number") return secondsToWall(attributes.schedule_start, zone).slice(0, 10);
    return typeof attributes.schedule_date === "number" ? secondsToDay(attributes.schedule_date) : "";
}