import { LabloomError } from "../failure";
import { type LinkTarget } from "../types/content";
import { validTimeSeconds } from "../content/time";
import { attributeTypes, type AttributeDefinition, type AttributeMetadata, type AttributeType, type AttributeValue } from "../types/attributes";

const optionMetadata = {
    initial: { options: [] },
    validate(value: Record<string, unknown>): boolean {
        const options = value.options;
        return Object.keys(value).length === 1 && Array.isArray(options) && options.length <= 10000
            && options.every(item => record(item) && Object.keys(item).length === 2 && typeof item.id === "string" && !!item.id
                && typeof item.name === "string" && !!item.name.trim() && item.name.length <= 100)
            && new Set(options.map(item => item.id)).size === options.length
            && new Set(options.map(item => item.name)).size === options.length;
    }
};
type ValueRule = ({ empty: null | "" | readonly [] } | { default: AttributeValue }) & { metadata?: typeof optionMetadata; target?: "page" | "file" };
const valueRules = {
    boolean: { default: false },
    string: { empty: "" }, url: { empty: "" },
    number: { empty: null }, minute: { empty: null }, hour: { empty: null },
    day: { empty: null }, month: { empty: null }, year: { empty: null }, recurrence: { empty: null },
    select: { empty: null, metadata: optionMetadata }, "page-link": { empty: null, target: "page" }, file: { empty: null, target: "file" }, json: { empty: null },
    multiselect: { empty: [], metadata: optionMetadata }, "page-links": { empty: [], target: "page" }, files: { empty: [], target: "file" }
} as const satisfies Record<AttributeType, ValueRule>;

export function attributeTargetKind(type: AttributeType): "page" | "file" | undefined {
    const rule = valueRules[type];
    return "target" in rule ? rule.target : undefined;
}

export function attributeTargets(type: AttributeType, value: AttributeValue): LinkTarget[] {
    const rule = valueRules[type];
    if (!("target" in rule)) return [];
    const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return (ids as string[]).map(id => ({ kind: rule.target, id }));
}

export function defaultMetadata(type: AttributeType): AttributeMetadata {
    const rule = valueRules[type];
    return "metadata" in rule ? structuredClone(rule.metadata.initial) : {};
}

export function validateMetadata(type: AttributeType, value: unknown): asserts value is AttributeMetadata {
    const rule = valueRules[type];
    if (!record(value) || !("metadata" in rule ? rule.metadata.validate(value) : Object.keys(value).length === 0)) {
        throw new LabloomError({ kind: "attribute-invalid-metadata", type });
    }
}

export function convertMetadata(from: AttributeType, to: AttributeType, value: AttributeMetadata): AttributeMetadata {
    return from === to || (["select", "multiselect"].includes(from) && ["select", "multiselect"].includes(to))
        ? structuredClone(value) : defaultMetadata(to);
}

export function nullable(type: AttributeType): boolean {
    return "empty" in valueRules[type];
}

export function emptyValue(type: AttributeType): AttributeValue {
    const rule = valueRules[type];
    if (!("empty" in rule)) throw new LabloomError({ kind: "attribute-not-nullable" });
    return typeof rule.empty === "object" && rule.empty !== null ? [] : rule.empty;
}

export function defaultValue(type: AttributeType): AttributeValue {
    const rule = valueRules[type];
    return "default" in rule ? rule.default : emptyValue(type);
}

export function isEmpty(type: AttributeType, value: unknown): boolean {
    const rule = valueRules[type];
    if (!("empty" in rule)) return false;
    return Array.isArray(rule.empty) ? Array.isArray(value) && value.length === 0 : value === rule.empty;
}

export function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validUUID(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function jsonValue(value: unknown, depth = 0): value is AttributeValue {
    if (depth > 40) return false;
    if (value === null || typeof value === "boolean" || typeof value === "string") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => jsonValue(item, depth + 1));
    return record(value) && Object.entries(value).every(([key, item]) => !["__proto__", "constructor", "prototype"].includes(key) && jsonValue(item, depth + 1));
}

export function validateDefinition(value: unknown): asserts value is AttributeDefinition {
    if (!record(value) || typeof value.id !== "string" || !attributeTypes.includes(value.type as never) || !record(value.metadata)) throw new LabloomError({ kind: "attribute-invalid-definition" });
    if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 100) throw new LabloomError({ kind: "attribute-invalid-name" });
    if ([value.hidden, value.readonly].some(flag => flag !== undefined && typeof flag !== "boolean")) throw new LabloomError({ kind: "attribute-invalid-permissions" });
    validateMetadata(value.type as AttributeType, value.metadata);
}

export function validateValue(definition: AttributeDefinition, value: unknown): asserts value is AttributeValue {
    if (isEmpty(definition.type, value)) return;
    let valid = false;
    const options = definition.metadata.options ?? [];
    switch (definition.type) {
        case "string": valid = typeof value === "string";
            break;
        case "number": valid = typeof value === "number" && Number.isFinite(value);
            break;
        case "boolean": valid = typeof value === "boolean";
            break;
        case "minute": case "hour": case "day": case "month": case "year": valid = validTimeSeconds(definition.type, value);
            break;
        case "select": valid = typeof value === "string" && options.some(option => option.id === value);
            break;
        case "multiselect": valid = Array.isArray(value) && new Set(value).size === value.length && value.every(id => options.some(option => option.id === id));
            break;
        case "file": case "page-link": valid = validUUID(value);
            break;
        case "files": case "page-links": valid = Array.isArray(value) && new Set(value).size === value.length && value.every(validUUID);
            break;
        case "url": {
            try {
                valid = typeof value === "string" && ["http:", "https:"].includes(new URL(value).protocol);
            }
            catch {
                valid = false;
            }
            break;
        }
        case "recurrence": valid = record(value) && Object.keys(value).length === 2 && Number.isSafeInteger(value.every) && Number(value.every) > 0 && ["minute", "hour", "day", "week", "month"].includes(String(value.unit));
            break;
        case "json": valid = jsonValue(value);
            break;
    }
    if (!valid) throw new LabloomError({ kind: "attribute-invalid-value", attrId: definition.id, name: definition.name ?? definition.id, type: definition.type });
}

export function encodeValue(definition: AttributeDefinition, value: AttributeValue): string | number | null {
    validateValue(definition, value);
    if (definition.type === "boolean") return value ? 1 : 0;
    if (definition.type === "recurrence") return value === null ? null : JSON.stringify(value);
    if (["json", "multiselect", "page-links", "files"].includes(definition.type)) return JSON.stringify(value);
    return value as string | number | null;
}

export function decodeValue(definition: AttributeDefinition, value: unknown): AttributeValue {
    let result = definition.type === "recurrence" && typeof value === "string" ? JSON.parse(value) : value;
    if (definition.type === "boolean") {
        if (value !== 0 && value !== 1) throw new LabloomError({ kind: "attribute-invalid-boolean" });
        result = value === 1;
    }
    else if (["json", "multiselect", "page-links", "files"].includes(definition.type)) {
        if (typeof value !== "string") throw new LabloomError({ kind: "attribute-invalid-compound" });
        result = JSON.parse(value);
    }
    validateValue(definition, result);
    return result;
}