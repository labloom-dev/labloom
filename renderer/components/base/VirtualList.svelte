<script module lang="ts">
    export type ListPosition = { id?: string; index: number; offset: number };
</script>

<script lang="ts">
    import { onDestroy, untrack, type Snippet } from "svelte";
    import { feedShortcuts, isComposingKey } from "../../../shared/content/commands";
    import { t } from "../../i18n.svelte";
    import Tooltip from "./Tooltip.svelte";

    let { ids, label, empty, pending = false, lines = 2, selected, row, onrange, onopen, onmove, onsettle, oncontext }: {
        ids: readonly string[]; label: string; empty: string; pending?: boolean; lines?: 1 | 2; selected?: string;
        row: Snippet<[id: string]>; onrange: (first: number, end: number) => void; onopen: (id: string) => void;
        onmove?: (id: string, holding: boolean) => void; onsettle?: () => void; oncontext?: (id: string, x: number, y: number) => void;
    } = $props();

    const uid = $props.id();
    let viewport: HTMLElement;
    let height = $state(0), rowHeight = $state(untrack(() => 24 * lines)), scroll = $state(0);
    let cursor = $state("");
    let heldKey = "";
    const focused = $derived(selected ?? cursor);
    const size = $derived(rowHeight || 24 * lines);
    const first = $derived(Math.floor(scroll / size));
    const count = $derived(Math.max(1, Math.ceil(height / size)));
    const buffer = $derived(first ? 12 : 4), step = $derived(first ? 6 : 1);
    const start = $derived(Math.max(0, Math.floor((first - buffer) / step) * step));
    const end = $derived(Math.min(ids.length, Math.ceil((first + count) / step) * step + buffer));
    const visible = $derived(ids.slice(start, end));
    $effect(() => {
        const from = start, to = end;
        void ids;
        untrack(() => onrange(from, to));
    });

    let idle: number | undefined;
    let tip = $state<HTMLElement>(), hover: HTMLElement | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    function hideTip(): void {
        clearTimeout(timer);
        hover = undefined; tip = undefined;
    }
    function inspect(event: PointerEvent): void {
        const text = (event.target as Element).closest<HTMLElement>("[data-list-label]");
        if (text === hover) return;
        hideTip();
        if (!text || text.scrollWidth <= text.clientWidth) return;
        hover = text;
        timer = setTimeout(() => {
            if (text.isConnected) tip = text;
        }, 450);
    }
    function scrolled(event: Event & { currentTarget: HTMLElement }): void {
        const list = event.currentTarget;
        if (list !== viewport) return;
        hideTip();
        if (!list.clientHeight) return;
        const top = list.scrollTop, index = Math.floor(top / size);
        if (index < start || Math.min(ids.length, index + count) > end) scroll = top;
        else if (idle === undefined) idle = requestIdleCallback(() => {
            idle = undefined;
            if (list === viewport && list.clientHeight) scroll = list.scrollTop;
        }, { timeout: 24 });
    }
    export function position(): ListPosition {
        const at = viewport?.clientHeight ? viewport.scrollTop : scroll, index = Math.floor(at / size);
        return { id: ids[index], index, offset: at % size };
    }
    export function scrollToRow(index: number, offset = 0): void {
        if (!viewport) return;
        const top = Math.min(Math.max(0, index) * size + offset, Math.max(0, ids.length * size - viewport.clientHeight));
        scroll = top;
        if (viewport.clientHeight) viewport.scrollTop = top;
    }
    export function restorePosition(at?: ListPosition): void {
        if (!at) return;
        const index = at.id ? ids.indexOf(at.id) : -1;
        if (index === at.index && position().id === at.id) return;
        scrollToRow(index >= 0 ? index : Math.min(at.index, ids.length - 1), at.offset);
    }
    export function focus(): void {
        viewport?.focus({ preventScroll: true });
    }
    export function reveal(id: string): void {
        const index = ids.indexOf(id);
        if (index < 0 || !viewport.clientHeight) return;
        const top = index * size, bottom = top + size;
        if (top < viewport.scrollTop) viewport.scrollTop = scroll = top;
        else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = scroll = bottom - viewport.clientHeight;
    }

    function open(id: string): void {
        heldKey = "";
        cursor = id;
        onopen(id);
    }
    function release(event?: KeyboardEvent): void {
        if (!heldKey || event && (event.key !== heldKey || isComposingKey(event))) return;
        heldKey = "";
        onsettle?.();
    }
    function target(event: MouseEvent): string | undefined {
        return (event.target as Element).closest<HTMLElement>("[data-list-row]")?.dataset.listRow;
    }
    function click(event: MouseEvent): void {
        const id = target(event);
        if (id && !pending) {
            focus(); open(id);
        }
    }
    function context(event: MouseEvent): void {
        const id = target(event);
        if (!id || !oncontext || pending) return;
        event.preventDefault();
        focus();
        oncontext(id, event.clientX, event.clientY);
    }
    function keys(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event) || pending || !ids.length) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const index = ids.indexOf(focused), key = event.key;
        let move = index;
        if (key === "ContextMenu" || event.shiftKey && key === feedShortcuts.menu) {
            if (!oncontext || index < 0) return;
            const box = document.getElementById(uid + focused)?.getBoundingClientRect() ?? viewport.getBoundingClientRect();
            oncontext(focused, box.left, box.bottom);
        }
        else if (event.shiftKey) return;
        else if (key === "Enter" && index >= 0 && !event.repeat) open(focused);
        else if (key === feedShortcuts.previous) move--;
        else if (key === feedShortcuts.next) move++;
        else if (key === feedShortcuts.first) move = 0;
        else if (key === feedShortcuts.last) move = ids.length - 1;
        else if (key === feedShortcuts.screenUp || key === feedShortcuts.screenDown) move += (key === feedShortcuts.screenDown ? 1 : -1) * Math.max(1, count - 1);
        else return;
        event.preventDefault();
        event.stopPropagation();
        if (move === index) return;
        const id = ids[Math.max(0, Math.min(ids.length - 1, move))];
        if (id === focused) return;
        cursor = id;
        heldKey = onsettle && (key === feedShortcuts.next || key === feedShortcuts.previous) ? key : "";
        onmove?.(id, !!heldKey);
        reveal(id);
    }

    onDestroy(() => {
        clearTimeout(timer);
        if (idle !== undefined) cancelIdleCallback(idle);
    });
</script>

<div class="virtual-list" role="listbox" aria-label={label} tabindex="0" aria-busy={pending}
    aria-activedescendant={visible.includes(focused) ? uid + focused : undefined} bind:this={viewport} bind:clientHeight={height}
    onscroll={scrolled} onclick={click} onkeydown={keys} onkeyup={release} onblur={() => release()} oncontextmenu={context} onpointerover={inspect} onpointerleave={hideTip}
    style:--list-row-height={`calc(${lines} * var(--ui-row-height))`}>
    <div class="metric" aria-hidden="true" bind:offsetHeight={rowHeight}></div>
    <div aria-hidden="true" style:height={Math.min(start, ids.length) * size + "px"}></div>
    {#each visible as id, i (id)}
        <div class="virtual-row" id={uid + id} data-list-row={id} role="option" aria-selected={id === focused}
            aria-setsize={ids.length} aria-posinset={start + i + 1}>
            {@render row(id)}
        </div>
    {/each}
    <div aria-hidden="true" style:height={Math.max(0, ids.length - end) * size + "px"}></div>
    {#if !ids.length}<div class="empty">{pending ? t("library.loading") : empty}</div>{/if}
</div>
{#if tip}<Tooltip text={tip.textContent ?? ""} anchor={tip} open />{/if}

<style>
    .virtual-list { flex: 1; min-width: 0; min-height: 0; overflow: auto; position: relative; isolation: isolate; overflow-anchor: none; background: var(--ui-surface-window); }
    .virtual-list:focus { outline: none; }
    .virtual-list:focus-visible { outline: var(--ui-focus-width) solid var(--ui-focus); outline-offset: calc(-1 * var(--ui-focus-width)); }
    .metric { position: absolute; pointer-events: none; visibility: hidden; height: var(--list-row-height); }
    .virtual-row { display: flex; flex-direction: column; justify-content: center; padding-inline: var(--ui-space-3); height: var(--list-row-height); box-sizing: border-box; overflow: hidden; user-select: none; cursor: pointer; }
    .virtual-row:hover { background: var(--ui-hover); }
    .virtual-row[aria-selected="true"] { background: var(--ui-selected-inactive); color: var(--ui-text-selected); }
    .virtual-list:focus .virtual-row[aria-selected="true"] { background: var(--ui-selected); }
    .empty { color: var(--ui-text-secondary); padding: var(--ui-space-3); font-size: var(--ui-font-small); }
</style>