import { secondsToDay, secondsToMonth, secondsToWall, secondsToYear } from "../content/time";
import { type AttributeDefinition, type AttributeFormat, type AttributeType, type AttributeValue } from "../types/attributes";
import { builtinValueFormats, isBuiltin } from "./builtins";
import { isEmpty } from "./values";

type Context = { zone?: string };
type Format = AttributeFormat;
const empty: Format = () => "";
const plain: Format = (_, value) => String(value);
const options: Format = (definition, value) => {
    const selected = Array.isArray(value) ? value : [value];
    return selected.map(id => definition.metadata.options?.find(option => option.id === id)?.name).filter(Boolean).join("、");
};
const defaults: Record<AttributeType, { display: Format; search?: Format }> = {
    string: { display: plain }, url: { display: plain }, number: { display: plain },
    minute: { display: (_, value, { zone }) => secondsToWall(value as number, zone).replace("T", " ") },
    hour: { display: (_, value, { zone }) => secondsToWall(value as number, zone).slice(0, 13).replace("T", " ") + "时" },
    day: { display: (_, value) => secondsToDay(value as number) },
    month: { display: (_, value) => secondsToMonth(value as number) },
    year: { display: (_, value) => secondsToYear(value as number) },
    select: { display: options }, multiselect: { display: options },
    boolean: { display: (_, value) => value ? "是" : "否", search: empty },
    "page-link": { display: empty }, "page-links": { display: empty }, json: { display: empty }
};

export function display(definition: AttributeDefinition, value: AttributeValue, context: Context = {}): string {
    if (isEmpty(definition.type, value)) return "";
    const override = isBuiltin(definition.id) ? builtinValueFormats[definition.id]?.display : undefined;
    return (override ?? defaults[definition.type].display)(definition, value, context);
}

export function search(definition: AttributeDefinition, value: AttributeValue, context: Context = {}): string {
    if (isEmpty(definition.type, value)) return "";
    const override = isBuiltin(definition.id) ? builtinValueFormats[definition.id]?.search : undefined;
    return (override ?? defaults[definition.type].search ?? display)(definition, value, context);
}