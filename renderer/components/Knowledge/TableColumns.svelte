<script lang="ts">
    import { isComposingKey } from "../../../shared/content/commands";
    import type { ViewSort } from "../../../shared/workspace/query";
    import { fieldColumn, type TableColumn } from "../../../shared/workspace/table";
    import { t } from "../../i18n.svelte";
    import Menu, { type MenuItem } from "../base/Menu.svelte";
    import Icon from "../utils/Icon.svelte";

    let { columns, choices, sort, label, onsort, onchange, onreset }: {
        columns: TableColumn[]; choices: string[]; sort: ViewSort[]; label: (id: string) => string;
        onsort: (id: string, extend: boolean) => void; onchange: (columns: TableColumn[]) => void; onreset: () => void;
    } = $props();
    let header: HTMLElement, dragging = "", resize: { id: string; x: number; width: number } | undefined;
    const items = $derived<MenuItem[]>([...choices.map(id => ({
        label: label(id), checked: columns.some(c => c.id === id), disabled: id === "title",
        onselect: () => onchange(columns.some(c => c.id === id) ? columns.filter(c => c.id !== id) : [...columns, { id }])
    })), { separator: true }, { label: t("library.defaultColumns"), onselect: onreset }]);
    function width(id: string, px: number): void {
        onchange(columns.map(c => c.id === id ? { id, width: Math.max(44, Math.ceil(px)) } : c));
    }
    function fit(id: string): void {
        const cells = header.parentElement!.querySelectorAll<HTMLElement>("[data-column=\"" + CSS.escape(id) + "\"]");
        let max = 44;
        for (const cell of cells) {
            const label = cell.querySelector<HTMLElement>(".cell-label");
            if (!label) continue;
            const range = document.createRange();
            range.selectNodeContents(label);
            const style = getComputedStyle(label.parentElement!);
            const icons = Array.from(cell.querySelectorAll<HTMLElement>(".icon"), el => el.offsetWidth + (parseFloat(style.columnGap) || 0));
            max = Math.max(max, range.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + icons.reduce((a, b) => a + b, 0) + 2);
        }
        width(id, max);
    }
    function drop(event: DragEvent, id: string): void {
        if (!dragging) return;
        event.preventDefault();
        if (dragging !== id) {
            const ordered = [...columns], from = ordered.findIndex(c => c.id === dragging), to = ordered.findIndex(c => c.id === id);
            ordered.splice(to, 0, ...ordered.splice(from, 1));
            onchange(ordered);
        }
        dragging = "";
    }
</script>

<Menu context {items}>
    {#snippet trigger({ props })}
        <div {...props} bind:this={header} class="column-heads" role="row">
            {#each columns as column (column.id)}
                {@const id = column.id}
                {@const rank = sort.findIndex(item => fieldColumn(item.field) === id)}
                {@const direction = sort[rank]?.direction}
                <div role="columnheader" data-column={id} aria-sort={rank !== 0 ? "none" : direction === "asc" ? "ascending" : "descending"}
                    ondragover={event => {
                        if (dragging) event.preventDefault();
                    }} ondrop={event => drop(event, id)}>
                    <button class="column-sort" draggable="true" ondragstart={event => {
                        dragging = id; event.dataTransfer?.setData("application/x-labloom-column", id);
                    }} ondragend={() => dragging = ""} onclick={event => onsort(id, event.shiftKey)} onkeydown={event => {
                        if (isComposingKey(event) && (event.key === "Enter" || event.key === " ")) event.preventDefault();
                    }}>
                        <span class="cell-label">{label(id)}</span>
                        {#if rank >= 0}
                            <Icon name={direction === "asc" ? "chevron-up" : "chevron-down"} size="var(--ui-icon-small)" />
                            {#if sort.length > 1}<span aria-label={t("table.sortLevel", { level: rank + 1 })}>{rank + 1}</span>{/if}
                        {/if}
                    </button>
                    <div class="column-sash" role="separator" aria-orientation="vertical" tabindex="0" aria-label={t("library.width", { name: label(id) })}
                        aria-valuenow={column.width} onpointerdown={event => {
                            if (event.button !== 0) return;
                            event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
                            resize = { id, x: event.clientX, width: event.currentTarget.parentElement!.offsetWidth };
                        }} onpointermove={event => {
                            if (resize?.id === id && event.currentTarget.hasPointerCapture(event.pointerId)) width(id, resize.width + event.clientX - resize.x);
                        }} onlostpointercapture={() => resize = undefined} ondblclick={() => fit(id)} onkeydown={event => {
                            if (isComposingKey(event) || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                            event.preventDefault(); event.stopPropagation(); width(id, event.currentTarget.parentElement!.offsetWidth + (event.key === "ArrowLeft" ? -1 : 1));
                        }}></div>
                </div>
            {/each}
        </div>
    {/snippet}
</Menu>

<style>
    .column-heads { display: grid; grid-template-columns: var(--library-tracks); position: sticky; top: 0; z-index: 2; min-width: var(--library-min-width); width: 100%; height: var(--ui-row-height); background: var(--ui-surface-panel); border-bottom: var(--ui-stroke) solid var(--ui-divider); }
    [role="columnheader"] { position: relative; min-width: 0; }
    .column-sort { display: flex; align-items: center; width: 100%; height: 100%; gap: var(--ui-space-2); padding-inline: var(--ui-space-3); font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    .column-sort:hover { background: var(--ui-hover); }
    .cell-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .column-sash { position: absolute; right: 0; inset-block: 0; width: var(--ui-sash-size); cursor: ew-resize; touch-action: none; border-right: var(--ui-stroke) solid var(--ui-divider); }
    .column-sash:hover, .column-sash:focus-visible { background: var(--ui-accent); }
</style>