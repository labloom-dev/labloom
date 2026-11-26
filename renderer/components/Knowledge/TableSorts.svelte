<script lang="ts">
    import { isComposingKey } from "../../../shared/content/commands";
    import type { ViewSort } from "../../../shared/workspace/query";
    import { columnField, fieldColumn } from "../../../shared/workspace/table";
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Select from "../base/Select.svelte";
    import Combobox from "../base/Combobox.svelte";

    let { sort, choices, label, onchange }: { sort: ViewSort[]; choices: string[]; label: (id: string) => string;
        onchange: (sort: ViewSort[]) => void } = $props();
    let dragging: number | undefined;
    const used = $derived(new Set(sort.map(item => fieldColumn(item.field))));
    const remaining = $derived(choices.filter(id => !used.has(id)));
    const directions = $derived([{ value: "asc", label: t("table.ascending") }, { value: "desc", label: t("table.descending") }]);

    function update(i: number, level: ViewSort): void {
        onchange(sort.map((item, index) => i === index ? level : item));
    }
    function drop(event: DragEvent, i: number): void {
        if (dragging === undefined) return;
        event.preventDefault();
        if (dragging !== i) {
            const next = [...sort];
            next.splice(i, 0, ...next.splice(dragging, 1));
            onchange(next);
        }
        dragging = undefined;
    }
    function guard(event: KeyboardEvent): void {
        if (isComposingKey(event) && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    }
</script>

<div class="sorting">
    {#each sort as item, i (fieldColumn(item.field))}
        {@const id = fieldColumn(item.field)}
        <div class="sort-row" role="group" aria-label={t("table.sortLevel", { level: i + 1 })} ondragover={event => {
            if (dragging !== undefined) event.preventDefault();
        }} ondrop={event => drop(event, i)}>
            <IconButton icon="gripper" label={t("table.moveSort")} draggable="true" ondragstart={event => {
                dragging = i;
                event.dataTransfer?.setData("application/x-labloom-sort", String(i));
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            }} ondragend={() => dragging = undefined} />
            <Combobox label={t("table.field")} options={choices.filter(value => value === id || !used.has(value)).map(value => ({ value, label: label(value) }))}
                value={id} onchange={value => update(i, { ...item, field: columnField(value) })} />
            <Select label={t("table.direction")} options={directions} value={item.direction}
                onchange={direction => update(i, { ...item, direction: direction as ViewSort["direction"] })} />
            <IconButton icon="close" label={t("table.removeSort")} onkeydown={guard} onclick={() => onchange(sort.filter((_, index) => i !== index))} />
        </div>
    {/each}
    <Button variant="text" icon="add" disabled={!remaining.length} onkeydown={guard}
        onclick={() => {
            if (remaining.length) onchange([...sort, { field: columnField(remaining[0]), direction: "asc" }]);
        }}>{t("table.addSort")}</Button>
</div>

<style>
    .sorting { width: min(calc(var(--ui-search-width) * .7), calc(100vw - 4 * var(--ui-space-3))); display: flex; flex-direction: column; gap: var(--ui-space-2); }
    .sorting > :global(.ui-control) { align-self: start; }
    .sort-row { display: grid; grid-template-columns: auto minmax(0, 1.5fr) minmax(0, 1fr) auto; align-items: center; gap: var(--ui-space-2); }
    .sort-row :global([draggable="true"]) { cursor: grab; }
</style>