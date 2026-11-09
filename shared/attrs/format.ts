import { secondsToWall } from "../content/time";
import { type AttributeDefinition, type AttributeFormat, type AttributeType, type AttributeValue } from "../types/attributes";
import { builtinValueFormats, isBuiltin } from "./builtins";

type Context = { zone?: string };
type Format = AttributeFormat;
const empty: Format = () => "";
const plain: Format = (_, value) => String(value);
const options: Format = (definition, value) => {
    const selected = Array.isArray(value) ? value : [value];
    return selected.map(id => definition.metadata.options?.find(option => option.id === id)?.name).filter(Boolean).join("、");
};
const defaults: Record<AttributeType, { display: Format; search?: Format }> = {
    string: { display: plain }, url: { display: plain }, number: { display: plain }, date: { display: plain },
    datetime: { display: (_, value, { zone }) => secondsToWall(value as number, zone).replace("T", " ") },
    select: { display: options }, multiselect: { display: options },
    boolean: { display: (_, value) => value ? "是" : "否", search: empty },
    "page-link": { display: empty }, "page-links": { display: empty }, json: { display: empty }
};

export function display(definition: AttributeDefinition, value: AttributeValue, context: Context = {}): string {
    if (value === null) return "";
    const override = isBuiltin(definition.id) ? builtinValueFormats[definition.id]?.display : undefined;
    return (override ?? defaults[definition.type].display)(definition, value, context);
}

export function search(definition: AttributeDefinition, value: AttributeValue, context: Context = {}): string {
    if (value === null) return "";
    const override = isBuiltin(definition.id) ? builtinValueFormats[definition.id]?.search : undefined;
    return (override ?? defaults[definition.type].search ?? display)(definition, value, context);
}