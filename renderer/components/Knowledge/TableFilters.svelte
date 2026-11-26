<script lang="ts">
    import { tick } from "svelte";
    import { isComposingKey } from "../../../shared/content/commands";
    import type { AttributeDefinition } from "../../../shared/types/attributes";
    import { fieldType, operatorsFor, type QueryOperator, type ViewCondition } from "../../../shared/workspace/query";
    import { columnField, fieldColumn } from "../../../shared/workspace/table";
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Select from "../base/Select.svelte";
    import Combobox from "../base/Combobox.svelte";
    import TableFilterValue from "./TableFilterValue.svelte";
    import { operatorLabel } from "./query-labels";

    let { conditions, choices, definitions, label, names, zone, focus, onchange }: { conditions: ViewCondition[]; choices: string[];
        definitions: ReadonlyMap<string, AttributeDefinition>; label: (id: string) => string; names: Record<string, string>;
        zone: string; focus?: { index: number }; onchange: (values: ViewCondition[]) => void } = $props();
    let form: HTMLElement;
    const selectable = $derived(choices.filter(id => {
        const type = fieldType(columnField(id), definitions);
        return type && operatorsFor(type).length;
    }).map(value => ({ value, label: label(value) })));

    $effect(() => {
        const index = focus?.index;
        if (index === undefined) return;
        void tick().then(() => {
            const row = form?.querySelectorAll<HTMLElement>("[data-filter-row]")[index];
            row?.scrollIntoView({ block: "nearest" });
            row?.querySelector("button")?.focus({ preventScroll: true });
        });
    });
    function newCondition(id: string): ViewCondition {
        const field = columnField(id), type = fieldType(field, definitions);
        return { field, operator: type ? operatorsFor(type)[0] : "contains", values: [] };
    }
    function update(i: number, condition: ViewCondition): void {
        onchange(conditions.map((item, index) => i === index ? condition : item));
    }
    function guard(event: KeyboardEvent): void {
        if (isComposingKey(event) && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    }
</script>

<div class="filter-list" bind:this={form}>
    {#each conditions as condition, i (i)}
        {@const field = fieldColumn(condition.field)}
        {@const type = fieldType(condition.field, definitions)}
        {#if type}
            <div class="filter-row" data-filter-row>
                <Combobox label={t("table.field")} options={selectable} value={field} onchange={value => update(i, newCondition(value))} />
                <Select label={t("table.operator")} value={condition.operator}
                    options={operatorsFor(type).map(value => ({ value, label: operatorLabel(value, type) }))}
                    onchange={operator => update(i, { ...condition, operator: operator as QueryOperator, values: [] })} />
                <div>
                    {#key field + ":" + condition.operator}
                        <TableFilterValue {condition} {type} {zone} {names} definition={definitions.get(field)}
                            onchange={values => update(i, { ...condition, values })} />
                    {/key}
                </div>
                <IconButton icon="close" label={t("table.removeCondition")} onkeydown={guard} onclick={() => onchange(conditions.filter((_, index) => i !== index))} />
            </div>
        {/if}
    {/each}
    <Button variant="text" icon="add" onkeydown={guard} onclick={() => {
        const index = conditions.length;
        onchange([...conditions, newCondition("title")]);
        void tick().then(() => form?.querySelectorAll<HTMLElement>("[data-filter-row]")[index]?.querySelector("button")?.focus());
    }}>{t("table.addCondition")}</Button>
</div>

<style>
    .filter-list { width: min(var(--ui-search-width), calc(100vw - 4 * var(--ui-space-3))); display: flex; flex-direction: column; gap: var(--ui-space-2); }
    .filter-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.8fr) auto; align-items: start; gap: var(--ui-space-2); }
    .filter-list > :global(.ui-control) { align-self: start; }
    .filter-row > :global(.ui-select) { width: 100%; }
</style>