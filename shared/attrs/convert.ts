import { isTimeType, secondsToDay, secondsToWall, timeToSeconds } from "../content/time";
import { type AttributeDefinition, type AttributeValue } from "../types/attributes";
import { display } from "./format";
import { defaultValue, isEmpty, validateValue } from "./values";

// Definition previews and confirmed writes share this conversion and fallback.
export function convertValue(before: AttributeDefinition, target: AttributeDefinition, value: AttributeValue, zone: string): AttributeValue {
    try {
        if (isEmpty(before.type, value)) return defaultValue(target.type);
        let result = value;
        if (isTimeType(target.type)) {
            if (isTimeType(before.type)) {
                const fromInstant = before.type === "minute" || before.type === "hour";
                const toInstant = target.type === "minute" || target.type === "hour";
                if (fromInstant && toInstant) result = value;
                else if (toInstant) result = timeToSeconds("minute", secondsToDay(value as number) + "T00:00", zone);
                else {
                    const day = fromInstant ? secondsToWall(value as number, zone).slice(0, 10) : secondsToDay(value as number);
                    result = timeToSeconds(target.type, target.type === "day" ? day : target.type === "month" ? day.slice(0, 7) : day.slice(0, 4), zone);
                }
            }
            else if (typeof value === "string") result = timeToSeconds(target.type, value, zone);
        }
        else if (isTimeType(before.type) && target.type === "string") result = display(before, value, { zone });
        if (target.type === "multiselect" && Array.isArray(result)) result = result.filter(id => target.metadata.options?.some(option => option.id === id));
        validateValue(target, result);
        return result;
    }
    catch {
        return defaultValue(target.type);
    }
}