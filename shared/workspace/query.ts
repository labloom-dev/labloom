import type { tags } from "typia";
import { validUUID } from "../attrs/values";
import { isTimeType, validTimeSeconds, type TimePrecision } from "../content/time";
import type { AttributeDefinition, AttributeType } from "../types/attributes";
import { pageKinds } from "../types/content";

type FieldId = string & tags.MinLength<1>;
export type ViewField = { kind: "title" } | { kind: "page-type" } | { kind: "attribute"; id: FieldId };
export type ViewFieldType = AttributeType | "title" | "page-type";

export const relativeDates = ["today", "yesterday", "tomorrow", "this-week", "last-week", "next-week", "this-month", "last-month", "next-month", "past-days", "next-days"] as const;
export type RelativeDate = { kind: "relative" } & (
    { period: Exclude<typeof relativeDates[number], "past-days" | "next-days"> }
    | { period: "past-days" | "next-days"; days: number & tags.Minimum<1> }
);
export type QueryDate = { kind: "absolute"; seconds: number; precision: TimePrecision } | RelativeDate;
export type QueryValue = string | number | boolean | QueryDate | { kind: "current-page" } | null;

const presence = ["empty", "not-empty"] as const;
const text = ["contains", "not-contains", "equals", "not-equals", ...presence] as const;
const single = ["in", "not-in", ...presence] as const;
const multiple = ["any", "all", "none", ...presence] as const;
const date = ["equals", "before", "after", "on-or-after", "on-or-before", "between", ...presence] as const;
const fieldOperators = {
    title: text, string: text, url: text,
    number: ["equals", "not-equals", "greater", "greater-or-equal", "less", "less-or-equal", ...presence],
    boolean: ["equals"],
    minute: date, hour: date, day: date, month: date, year: date,
    select: single, status: [...single, "incomplete", "complete"], multiselect: multiple,
    "page-type": ["in", "not-in"], "page-link": single, "page-links": multiple,
    file: presence, files: presence, recurrence: presence, json: []
} as const satisfies Record<ViewFieldType, readonly string[]>;

export type QueryOperator = typeof fieldOperators[ViewFieldType][number];
export type ViewCondition = { field: ViewField; operator: QueryOperator; values: QueryValue[] };
export type ViewSort = { field: ViewField; direction: "asc" | "desc" };
export const groupGranularities = ["day", "week", "month", "year"] as const;
export type GroupGranularity = typeof groupGranularities[number];
export type GroupValue = string | number | boolean | null;
export type ViewGroup = { field: ViewField; granularity?: GroupGranularity; collapsed: GroupValue[] };
export type ViewQuery = { conditions: ViewCondition[]; sort: ViewSort[]; group?: ViewGroup };

const groupingTypes: readonly ViewFieldType[] = ["select", "status", "multiselect", "page-link", "page-links", "boolean", "page-type"];
export function canGroup(type: ViewFieldType): boolean {
    return type !== "title" && type !== "page-type" && isTimeType(type) || groupingTypes.includes(type);
}

export function groupGranularity(precision: TimePrecision, granularity?: GroupGranularity): GroupGranularity {
    return granularity ?? (precision === "month" || precision === "year" ? precision : "day");
}

export function fieldKey(field: ViewField): string {
    return field.kind === "attribute" ? field.id : field.kind;
}

export function fieldType(field: ViewField, definitions: ReadonlyMap<string, AttributeDefinition>): ViewFieldType | undefined {
    if (field.kind !== "attribute") return field.kind;
    const definition = definitions.get(field.id);
    return definition?.hidden ? undefined : definition?.type;
}

export function operatorsFor(type: ViewFieldType): readonly QueryOperator[] {
    return fieldOperators[type];
}

export function needsValue(operator: QueryOperator): boolean {
    return operator !== "empty" && operator !== "not-empty" && operator !== "complete" && operator !== "incomplete";
}

export function conditionReady(condition: ViewCondition): boolean {
    return !needsValue(condition.operator) || (condition.operator === "between"
        ? condition.values.length === 2 && condition.values.every(value => value !== null)
        : condition.values.some(value => value !== null && ((condition.operator !== "contains" && condition.operator !== "not-contains") ||
            typeof value !== "string" || !!value.trim())));
}

function validOperand(type: ViewFieldType, value: QueryValue): boolean {
    if (value === null) return true;
    switch (type) {
        case "number": return typeof value === "number" && Number.isFinite(value);
        case "boolean": return typeof value === "boolean";
        case "page-type": return pageKinds.some(kind => kind === value);
        case "page-link": case "page-links": return validUUID(value) || typeof value === "object" && value.kind === "current-page";
        case "minute": case "hour": case "day": case "month": case "year":
            return typeof value === "object" && (value.kind === "absolute" ? value.precision === type && validTimeSeconds(type, value.seconds)
                : value.kind === "relative" && (!("days" in value) || Number.isSafeInteger(value.days) && value.days > 0));
        default: return typeof value === "string" && value !== "";
    }
}

export function repairViewQuery(query: ViewQuery, definitions: ReadonlyMap<string, AttributeDefinition>): ViewQuery {
    const conditions = query.conditions.filter(condition => {
        const type = fieldType(condition.field, definitions);
        if (!type || !operatorsFor(type).includes(condition.operator)) return false;
        if (!needsValue(condition.operator)) return true;
        const options = condition.field.kind === "attribute" ? definitions.get(condition.field.id)?.metadata.options : undefined;
        return condition.values.every(value => validOperand(type, value) && (!options || value === null || options.some(option => option.id === value)));
    });
    const sort = query.sort.filter(item => !!fieldType(item.field, definitions));
    let group = query.group;
    if (group) {
        const field = group.field, type = fieldType(field, definitions);
        if (!type || !canGroup(type) || group.granularity && (type === "title" || type === "page-type" || !isTimeType(type))) group = undefined;
        else {
            const options = field.kind === "attribute" ? definitions.get(field.id)?.metadata.options : undefined;
            const collapsed = [...new Set(group.collapsed)].filter(value => value === null || (type !== "title" && type !== "page-type" && isTimeType(type)
                ? validTimeSeconds("day", value)
                : validOperand(type, value) && (!options || options.some(option => option.id === value))));
            if (collapsed.length !== group.collapsed.length) group = { ...group, collapsed };
        }
    }
    if (conditions.length === query.conditions.length && sort.length === query.sort.length && group === query.group) return query;
    return { conditions, sort, ...(group ? { group } : {}) };
}