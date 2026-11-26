<script lang="ts">
    import { isComposingKey } from "../../../shared/content/commands";
    import type { AttributeDefinition } from "../../../shared/types/attributes";
    import { pageKinds } from "../../../shared/types/content";
    import { needsValue, type QueryDate, type QueryValue, type ViewCondition, type ViewFieldType } from "../../../shared/workspace/query";
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Input from "../base/Input.svelte";
    import Select from "../base/Select.svelte";
    import TableFilterChoices from "./TableFilterChoices.svelte";
    import TableFilterDate from "./TableFilterDate.svelte";
    import TargetPicker from "./TargetPicker.svelte";
    import { kindIcons } from "./labels";
    import { propertyOption } from "./attribute-labels";
    import { isDateField } from "./query-labels";

    let { condition, type, definition, zone, names, onchange }: { condition: ViewCondition; type: ViewFieldType; definition?: AttributeDefinition;
        zone: string; names: Record<string, string>; onchange: (values: QueryValue[]) => void } = $props();
    let picker = $state<{ x: number; y: number; left: number; right: number; bottom: number }>(), composing = false;
    const choices = $derived(type === "page-type" ? pageKinds.map(kind => ({ value: kind, label: t(`library.${kind}`), icon: kindIcons[kind] }))
        : (definition?.metadata.options ?? []).map(option => ({ value: option.id, label: definition ? propertyOption(definition, option) : option.name })));
    const strings = $derived(condition.values.filter((value): value is string => typeof value === "string"));
    const between = $derived(condition.operator === "between");
    const inputs = $derived(between ? [condition.values[0] ?? null, condition.values[1] ?? null] : condition.values.length ? condition.values : [null]);
    const boolean = $derived([{ value: "true", label: t("library.yes") }, { value: "false", label: t("library.no") }]);
    function set(i: number, value: QueryValue): void {
        onchange(inputs.map((item, n) => n === i ? value : item));
    }
    function text(i: number, raw: string): void {
        if (composing) return;
        const value = type === "number" ? raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw) : raw || null;
        set(i, value);
    }
    function choosePage(event: MouseEvent): void {
        const trigger = (event.currentTarget as HTMLElement).getBoundingClientRect();
        picker = { x: trigger.left, y: trigger.bottom, left: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
    }
    function addPage(id: string): void {
        if (!strings.includes(id)) onchange([...strings, id]);
        picker = undefined;
    }
    function guard(event: KeyboardEvent): void {
        if (isComposingKey(event) && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    }
</script>

{#if needsValue(condition.operator)}
    <div class="values">
        {#if type === "boolean"}
            <Select label={t("table.value")} options={boolean} value={condition.values[0] == null ? "" : String(condition.values[0])}
                placeholder={t("table.value")} onchange={value => onchange([value === "true"])} />
        {:else if type === "page-type" || definition?.metadata.options}
            <TableFilterChoices options={choices} values={strings} {onchange} />
        {:else if type === "page-link" || type === "page-links"}
            <div class="links">
                {#each strings as id (id)}
                    {@const name = names[id] || t("shell.untitled")}
                    <span title={name}>{name}<IconButton icon="close" label={t("property.removeItem", { name })} onkeydown={guard}
                        onclick={() => onchange(strings.filter(value => value !== id))} /></span>
                {/each}
                <Button variant="text" onclick={choosePage} onkeydown={guard}>{t("editor.choosePage")}</Button>
            </div>
            {#if picker}
                <TargetPicker mode="page" position={picker} onclose={() => picker = undefined} onselect={target => addPage(target.id)} />
            {/if}
        {:else}
            {#each inputs as value, i (i)}
                {@const label = t(between ? i === 0 ? "table.from" : "table.to" : "table.value")}
                <div class="operand">
                    {#if isDateField(type)}
                        <TableFilterDate {label} precision={type} {zone} value={value as QueryDate | null} onchange={next => set(i, next)} />
                    {:else}
                        <Input {label} placeholder={label} type={type === "number" ? "number" : "text"} value={value === null ? "" : String(value)}
                            oninput={value => text(i, value)} inputProps={{
                                step: type === "number" ? "any" : undefined,
                                oncompositionstart: () => composing = true,
                                oncompositionend: event => {
                                    composing = false; text(i, (event.currentTarget as HTMLInputElement).value);
                                }
                            }} />
                    {/if}
                    {#if !between && inputs.length > 1}
                        <IconButton icon="close" label={t("table.removeValue")} onkeydown={guard}
                            onclick={() => onchange(inputs.filter((_, n) => n !== i))} />
                    {/if}
                </div>
            {/each}
            {#if !between && inputs.at(-1) !== null}
                <IconButton icon="add" label={t("table.addValue")} onkeydown={guard} onclick={() => onchange([...inputs, null])} />
            {/if}
        {/if}
    </div>
{/if}

<style>
    .values { min-width: 0; display: grid; gap: var(--ui-space-1); align-content: start; }
    .values > :global(.ui-select) { width: 100%; }
    .operand, .links, .links span { display: flex; align-items: center; gap: var(--ui-space-1); min-width: 0; }
    .operand > :global(.ui-field) { flex: 1; min-width: 0; }
    .links { flex-wrap: wrap; }
    .links span { max-width: 100%; overflow: hidden; background: var(--ui-selected-inactive); padding-inline-start: var(--ui-space-2); border-radius: var(--ui-radius-control); }
</style>