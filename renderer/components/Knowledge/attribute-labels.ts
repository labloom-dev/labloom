import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
import * as formatting from "../../../shared/attrs/format";
import * as attrs from "../../../shared/attrs/builtins";
import * as i18n from "../../i18n.svelte";

export function propertyName(definition: AttributeDefinition): string {
    return attrs.isBuiltin(definition.id) ? i18n.t(`attributeName.${definition.id}`) : definition.name || definition.id;
}
export function propertyOption(definition: AttributeDefinition, option: { id: string; name: string }): string {
    const id = option.id;
    if (definition.id === "feed_status" && (id === "enabled" || id === "paused" || id === "cancelled")) return i18n.t(`property.${id}`);
    if (definition.id === "recycle_reason" && (id === "manual_delete" || id === "unreachable")) return i18n.t(id === "manual_delete" ? "property.manualDelete" : "property.unreachable");
    if (definition.id === "annotation_color" && (id === "yellow" || id === "green" || id === "purple" || id === "pink")) return i18n.t(`color.${id}`);
    return option.name;
}

export function propertyText(definition: AttributeDefinition, value: AttributeValue, zone: string): string {
    if (definition.type === "json") return JSON.stringify(value);
    if (definition.type === "recurrence" && value && typeof value === "object" && !Array.isArray(value) && typeof value.every === "number" && typeof value.unit === "string" && ["minute", "hour", "day", "week", "month"].includes(value.unit)) {
        const period = new Intl.NumberFormat(document.documentElement.lang || "zh-CN", { style: "unit", unit: value.unit, unitDisplay: "long" }).format(value.every);
        return i18n.t("property.repeatPeriod", { period });
    }
    if (definition.type === "select" || definition.type === "status" || definition.type === "multiselect") {
        const selected = Array.isArray(value) ? value : [value];
        const names = selected.flatMap(id => {
            const option = definition.metadata.options?.find(option => option.id === id);
            return option ? [propertyOption(definition, option)] : [];
        });
        return new Intl.ListFormat(document.documentElement.lang || "zh-CN", { type: "unit" }).format(names);
    }
    return formatting.display(definition, value, { zone });
}