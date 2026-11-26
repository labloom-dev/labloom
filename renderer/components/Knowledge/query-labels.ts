import { isTimeType, type TimePrecision } from "../../../shared/content/time";
import { fieldType, needsValue, type QueryOperator, type QueryValue, type RelativeDate, type ViewCondition, type ViewFieldType } from "../../../shared/workspace/query";
import { fieldColumn } from "../../../shared/workspace/table";
import type { AttributeDefinition } from "../../../shared/types/attributes";
import { pageKinds } from "../../../shared/types/content";
import { t } from "../../i18n.svelte";
import { pickerValueText } from "../base/date-picker";
import { propertyOption } from "./attribute-labels";

function relativeLabel(value: RelativeDate): string {
    return t(`table.relative.${value.period}`, "days" in value ? { count: value.days } : undefined);
}

export function operatorLabel(operator: QueryOperator, type?: ViewFieldType): string {
    if (type === "number" && operator === "equals") return t("table.operators.numberEquals");
    if (type === "number" && operator === "not-equals") return t("table.operators.numberNotEquals");
    return t(`table.operators.${operator}`);
}

function operandLabel(value: QueryValue, type: ViewFieldType, zone: string, names: Record<string, string>, definition?: AttributeDefinition): string {
    if (value === null) return "";
    if (typeof value === "object") {
        if (value.kind === "relative") return relativeLabel(value);
        if (value.kind === "absolute") return pickerValueText(type as TimePrecision, value.seconds, zone);
        return "";
    }
    if (type === "page-type") {
        const kind = pageKinds.find(kind => kind === value);
        return kind ? t(`library.${kind}`) : "";
    }
    if (type === "page-link" || type === "page-links") return names[String(value)] || t("shell.untitled");
    if (type === "boolean") return t(value ? "library.yes" : "library.no");
    const option = definition?.metadata.options?.find(option => option.id === value);
    return definition && option ? propertyOption(definition, option) : String(value);
}

export function conditionLabel(condition: ViewCondition, definitions: ReadonlyMap<string, AttributeDefinition>,
    label: (id: string) => string, zone: string, names: Record<string, string>): string {
    const id = fieldColumn(condition.field), type = fieldType(condition.field, definitions);
    const operator = operatorLabel(type === "page-type" && condition.operator === "in" && condition.values.length === 1 ? "equals" : condition.operator, type);
    const values = type && needsValue(condition.operator) ? condition.values.map(value => operandLabel(value, type, zone, names, definitions.get(id))).filter(Boolean) : [];
    return [label(id), operator, values.join(condition.operator === "between" ? " – " : t("table.valueSeparator"))].filter(Boolean).join(" ");
}

export function isDateField(type: ViewFieldType): type is TimePrecision {
    return type !== "title" && type !== "page-type" && isTimeType(type);
}