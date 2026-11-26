<script lang="ts">
    import type { AttributeDefinition } from "../../../shared/types/attributes";
    import { isComposingKey } from "../../../shared/content/commands";
    import { canGroup, fieldType, groupGranularities, groupGranularity, type GroupGranularity, type ViewGroup } from "../../../shared/workspace/query";
    import { columnField, fieldColumn } from "../../../shared/workspace/table";
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Select from "../base/Select.svelte";
    import Combobox from "../base/Combobox.svelte";
    import { isDateField } from "./query-labels";

    let { group, choices, definitions, label, onchange }: { group?: ViewGroup; choices: string[]; definitions: ReadonlyMap<string, AttributeDefinition>;
        label: (id: string) => string; onchange: (group?: ViewGroup) => void } = $props();
    const grouped = $derived(group ? fieldType(group.field, definitions) : undefined);
    const options = $derived(choices.filter(id => {
        const type = fieldType(columnField(id), definitions);
        return type && canGroup(type);
    }).map(value => ({ value, label: label(value) })));
    const granularity = $derived(grouped && isDateField(grouped) ? groupGranularity(grouped, group?.granularity) : undefined);
    const periods = $derived(groupGranularities.map(value => ({ value, label: t(`table.granularities.${value}`) })));
</script>

<div class="grouping">
    <Combobox label={t("table.field")} placeholder={t("table.field")} {options} value={group ? fieldColumn(group.field) : ""}
        onchange={id => {
            if (!group || fieldColumn(group.field) !== id) onchange({ field: columnField(id), collapsed: [] });
        }} />
    {#if group && granularity}
        <Select label={t("table.granularity")} options={periods} value={granularity} onchange={value => {
            if (group) onchange({ ...group, granularity: value as GroupGranularity, collapsed: [] });
        }} />
    {/if}
    <Button variant="text" disabled={!group} onclick={() => onchange()} onkeydown={event => {
        if (isComposingKey(event) && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    }}>{t("table.ungroup")}</Button>
</div>

<style>
    .grouping { width: min(calc(var(--ui-search-width) * .45), calc(100vw - 4 * var(--ui-space-3))); display: grid; align-items: start; gap: var(--ui-space-2); }
    .grouping > :global(button[data-variant="text"]) { justify-self: start; }
</style>