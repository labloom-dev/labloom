import { builtinAttrsByPageKind, isBuiltin } from "../attrs/builtins";
import { emptyValue, nullable, validateValue } from "../attrs/values";
import { isTimeType } from "../content/time";
import { pageKinds, type PageKind } from "../types/content";
import type { AttributeDefinition, AttributeValue } from "../types/attributes";
import { conditionReady, groupGranularity, type GroupValue, type QueryDate, type ViewCondition, type ViewQuery } from "./query";
import { dateBounds, dateGroup, groupDateValue } from "./query-time";

const multiple = (def: AttributeDefinition): boolean => def.type === "multiselect" || def.type === "page-links";

function dateValue(value: QueryDate, def: AttributeDefinition, zone: string, now: number): number | undefined {
    if (!isTimeType(def.type)) return undefined;
    if (value.kind === "absolute") return value.seconds;
    const [start, end] = dateBounds(value, def.type, zone, now);
    const [unitStart, unitEnd] = dateBounds({ kind: "absolute", precision: def.type, seconds: start }, def.type, zone, now);
    if (value.period === "today" || value.period === "yesterday" || value.period === "tomorrow" || unitStart === start && unitEnd === end) return start;
    return undefined;
}

function conditionValue(condition: ViewCondition, def: AttributeDefinition, zone: string, now: number): AttributeValue | undefined {
    if (condition.operator === "empty" && nullable(def.type)) return emptyValue(def.type);
    if (def.type === "status" && (condition.operator === "complete" || condition.operator === "incomplete")) {
        const options = def.metadata.options?.filter(option => option.group === condition.operator);
        return options?.length === 1 ? options[0].id : undefined;
    }
    const values = condition.values.filter(value => value !== null);
    if (multiple(def) && (condition.operator === "all" || condition.operator === "any" && values.length === 1)) {
        return values.every(value => typeof value === "string") ? [...new Set(values)] : undefined;
    }
    if (values.length !== 1 || (condition.operator !== "equals" && condition.operator !== "in")) return undefined;
    const value = values[0];
    if (typeof value !== "object") return value;
    return value.kind === "current-page" ? undefined : dateValue(value, def, zone, now);
}

export function viewCreation(query: ViewQuery, definitions: ReadonlyMap<string, AttributeDefinition>, zone: string, now: number,
    group?: GroupValue, forcedKind?: PageKind): { kind: PageKind; initial: Record<string, AttributeValue> } {
    const conditions = query.conditions.filter(conditionReady);
    const constrained = new Set(conditions.flatMap(({ field, operator, values }) => {
        const kinds = values.filter(value => value !== null);
        return field.kind === "page-type" && operator === "in" && kinds.length === 1 ? kinds : [];
    }));
    const groupedKind = query.group?.field.kind === "page-type" && pageKinds.find(kind => kind === group);
    const conditionKind = constrained.size === 1 && pageKinds.find(kind => constrained.has(kind));
    const kind = forcedKind ?? (groupedKind || conditionKind || "editable");
    const supported: readonly string[] = builtinAttrsByPageKind[kind];
    const chosen = new Map<string, AttributeValue>(), ambiguous = new Set<string>();
    function writable(id: string): AttributeDefinition | undefined {
        const def = definitions.get(id);
        return def && !def.hidden && !def.readonly && id !== "deleted" && (!isBuiltin(id) || supported.includes(id)) ? def : undefined;
    }
    for (const condition of conditions) {
        if (condition.field.kind !== "attribute") continue;
        const { id } = condition.field, def = writable(id);
        if (!def || ambiguous.has(id)) continue;
        const value = conditionValue(condition, def, zone, now);
        if (value === undefined) continue;
        const before = chosen.get(id);
        if (Array.isArray(value) && Array.isArray(before)) chosen.set(id, [...new Set([...before, ...value])]);
        else if (before === undefined || before === value) chosen.set(id, value);
        else {
 chosen.delete(id); ambiguous.add(id);
}
    }
    if (group !== undefined && query.group?.field.kind === "attribute") {
        const { id } = query.group.field, def = writable(id);
        if (def) {
            const before = chosen.get(id);
            if (group === null) {
                if (nullable(def.type)) chosen.set(id, emptyValue(def.type));
                else chosen.delete(id);
            }
            else if (isTimeType(def.type) && typeof group === "number") {
                const granularity = groupGranularity(def.type, query.group.granularity);
                if (typeof before !== "number" || dateGroup(before, def.type, granularity, zone) !== group)
                    chosen.set(id, groupDateValue(group, def.type, granularity, zone));
            }
            else if (multiple(def)) chosen.set(id, [...new Set([...(Array.isArray(before) ? before : []), group])]);
            else chosen.set(id, group);
        }
    }
    // A page created without a retaining parent must stay reachable.
    if (chosen.get("independent") === false) chosen.delete("independent");
    for (const [id, value] of chosen) {
        try {
            validateValue(definitions.get(id)!, value);
        }
        catch {
            chosen.delete(id);
        }
    }
    return { kind, initial: Object.fromEntries(chosen) };
}