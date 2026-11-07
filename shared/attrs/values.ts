import { attributeTypes, type AttributeDefinition, type AttributeValue } from "../types/attributes";

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
    if (!record(value) || typeof value.id !== "string" || !attributeTypes.includes(value.type as never) || !record(value.metadata)) throw new Error("属性定义无效。");
    if (value.metadata.name !== undefined && (typeof value.metadata.name !== "string" || !value.metadata.name.trim() || value.metadata.name.length > 100)) throw new Error("属性名称应为 1–100 个字符。");
    if (value.type === "select" || value.type === "multiselect") {
        const options = value.metadata.options;
        if (!Array.isArray(options) || options.length > 10000 || options.some(item => !record(item) || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || item.name.length > 100)) throw new Error("选项需要稳定标识和非空名称。");
        if (new Set(options.map(item => item.id)).size !== options.length || new Set(options.map(item => item.name)).size !== options.length) throw new Error("选项标识和名称不能重复。");
    }
    if (!jsonValue(value.metadata)) throw new Error("属性元数据必须是有效 JSON。");
}

export function validateValue(definition: AttributeDefinition, value: unknown): asserts value is AttributeValue {
    if (value === null) return;
    let valid = false;
    const options = definition.metadata.options ?? [];
    switch (definition.type) {
        case "string": valid = typeof value === "string";
            break;
        case "number": valid = typeof value === "number" && Number.isFinite(value);
            break;
        case "boolean": valid = typeof value === "boolean";
            break;
        case "date": valid = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
            break;
        case "datetime": valid = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
            break;
        case "select": valid = typeof value === "string" && options.some(option => option.id === value);
            break;
        case "multiselect": valid = Array.isArray(value) && new Set(value).size === value.length && value.every(id => options.some(option => option.id === id));
            break;
        case "page-link": valid = validUUID(value);
            break;
        case "page-links": valid = Array.isArray(value) && new Set(value).size === value.length && value.every(validUUID);
            break;
        case "url": {
            try {
                valid = typeof value === "string" && (!value || ["http:", "https:"].includes(new URL(value).protocol));
            }
            catch {
                valid = false;
            }
            break;
        }
        case "json": valid = jsonValue(value);
            break;
    }
    if (!valid) throw new Error(`“${definition.metadata.name ?? definition.id}”的值不符合 ${definition.type} 类型。`);
}

export function encodeValue(definition: AttributeDefinition, value: AttributeValue): string | number | null {
    validateValue(definition, value);
    if (value === null) return null;
    if (definition.type === "boolean") return value ? 1 : 0;
    if (["json", "multiselect", "page-links"].includes(definition.type)) return JSON.stringify(value);
    return value as string | number;
}

export function decodeValue(definition: AttributeDefinition, value: unknown): AttributeValue {
    let result = value;
    if (value !== null) {
        if (definition.type === "boolean") {
            if (value !== 0 && value !== 1) throw new Error("已保存的布尔属性无效。");
            result = value === 1;
        }
        else if (["json", "multiselect", "page-links"].includes(definition.type)) {
            if (typeof value !== "string") throw new Error("已保存的复合属性无效。");
            result = JSON.parse(value);
        }
    }
    validateValue(definition, result);
    return result;
}