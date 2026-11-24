import { type Language } from "../locale";
import { type Translate } from "../i18n";
import { secondsToDay, secondsToHour, secondsToMinute, secondsToMonth, secondsToYear } from "../content/time";
import { type AttributeDefinition, type AttributeFormat, type AttributeType, type AttributeValue } from "../types/attributes";
import { builtinValueFormats, isBuiltin } from "./builtins";
import { isEmpty } from "./values";

type Context = Parameters<AttributeFormat>[2];
const empty: AttributeFormat = () => "";
const plain: AttributeFormat = (_, value) => String(value);
const options: AttributeFormat = (definition, value) => {
    const selected = Array.isArray(value) ? value : [value];
    return selected.map(id => definition.metadata.options?.find(option => option.id === id)?.name).filter(Boolean).join("、");
};
const files: AttributeFormat = (_, value, { fileName }) => (Array.isArray(value) ? value : [value])
    .map(id => fileName?.(String(id))).filter(Boolean).join("、");
const defaults: Record<AttributeType, { display: AttributeFormat; search?: AttributeFormat }> = {
    recurrence: { display: (_, value) => {
        const item = value as { every: number; unit: string };
        return `每 ${item.every} ${{ minute: "分钟", hour: "小时", day: "天", week: "周", month: "个月" }[item.unit]}`;
    } },
    string: { display: plain }, url: { display: plain }, number: { display: plain },
    minute: { display: (_, value, { zone }) => secondsToMinute(value as number, zone) },
    hour: { display: (_, value, { zone }) => secondsToHour(value as number, zone) },
    day: { display: (_, value) => secondsToDay(value as number) },
    month: { display: (_, value) => secondsToMonth(value as number) },
    year: { display: (_, value) => secondsToYear(value as number) },
    select: { display: options }, status: { display: options }, multiselect: { display: options },
    boolean: { display: (_, value) => value ? "是" : "否", search: empty },
    file: { display: files }, files: { display: files },
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

/** The library uses this text both in cells and as its locale-aware sort key. */
export function libraryText(def: AttributeDefinition, value: AttributeValue | undefined, language: Language, zone: string, t: Translate, names: Record<string, string>): string {
    if (value == null || isEmpty(def.type, value)) return "";
    if (def.type === "boolean") return t(value ? "library.yes" : "library.no");
    if (def.type === "page-link" || def.type === "page-links" || def.type === "file" || def.type === "files") {
        return (Array.isArray(value) ? value : [value]).map(id => names[String(id)] === "" ? t("shell.untitled") : names[String(id)] ?? "").filter(Boolean).join(t("dialog.listJoin"));
    }
    if (def.type === "json") return JSON.stringify(value);
    if (def.type === "select" || def.type === "status" || def.type === "multiselect") {
        return (Array.isArray(value) ? value : [value]).map(id => {
            if (def.id === "feed_status" && (id === "enabled" || id === "paused" || id === "cancelled")) return t(`property.${id}`);
            if (def.id === "annotation_color" && (id === "yellow" || id === "green" || id === "purple" || id === "pink")) return t(`color.${id}`);
            return def.metadata.options?.find(o => o.id === id)?.name ?? "";
        }).filter(Boolean).join(t("dialog.listJoin"));
    }
    if (def.type === "recurrence") {
        const period = value as { every: number; unit: string };
        return t("property.repeatPeriod", { period: new Intl.NumberFormat(language, { style: "unit", unit: period.unit, unitDisplay: "long" }).format(period.every) });
    }
    return display(def, value, { zone });
}