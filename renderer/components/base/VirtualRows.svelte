<script lang="ts" generics="Item">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    let { items, row, itemKey, ...attributes }: HTMLAttributes<HTMLDivElement> & {
        items: readonly Item[];
        row: Snippet<[item: Item, index: number]>;
        itemKey?: (item: Item) => string;
    } = $props();

    let viewport: HTMLDivElement;
    let height = $state(0), measured = $state(0), scroll = $state(0);
    const size = $derived(measured || 24);
    const start = $derived(Math.max(0, Math.min(items.length - 1, Math.floor(scroll / size)) - 4));
    const end = $derived(Math.min(items.length, Math.ceil((scroll + height) / size) + 4));

    export function shows(index: number): boolean {
        return index >= start && index < end;
    }
    export function reset(): void {
        scroll = 0;
        if (viewport) viewport.scrollTop = 0;
    }
    export function reveal(index: number): void {
        if (!viewport || index < 0) return;
        const top = index * size, bottom = top + size;
        if (top < viewport.scrollTop) viewport.scrollTop = top;
        else if (bottom > viewport.scrollTop + height) viewport.scrollTop = bottom - height;
        scroll = viewport.scrollTop;
    }
</script>

<div {...attributes} class="virtual-rows" bind:this={viewport} bind:clientHeight={height} onscroll={event => scroll = event.currentTarget.scrollTop}>
    <div class="metric" aria-hidden="true" bind:offsetHeight={measured}></div>
    <div aria-hidden="true" style:height={start * size + "px"}></div>
    {#each items.slice(start, end) as item, offset (itemKey ? itemKey(item) : start + offset)}
        {@render row(item, start + offset)}
    {/each}
    <div aria-hidden="true" style:height={(items.length - end) * size + "px"}></div>
</div>

<style>
    .virtual-rows { position: relative; min-height: 0; overflow: auto; overflow-anchor: none; }
    .metric { position: absolute; visibility: hidden; height: var(--ui-row-height); }
</style>