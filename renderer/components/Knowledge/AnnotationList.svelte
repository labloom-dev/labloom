<script lang="ts">
    import { tick, untrack } from "svelte";
    import { annotationColors } from "../../../shared/content/annotations";
    import { annotationShortcuts, isComposingKey } from "../../../shared/content/commands";
    import type { PaperAnnotation } from "../../../shared/types/papers";
    import { t } from "../../i18n.svelte";
    import Menu, { type MenuItem } from "../base/Menu.svelte";

    let { items, selectedId, readOnly, visible, onselect, oncolor, onremove, onopen }: {
        items: PaperAnnotation[]; selectedId: string | null; readOnly: boolean; visible: boolean;
        onselect: (item: PaperAnnotation, at?: { x: number; y: number }) => void;
        oncolor: (id: string, color: string) => void; onremove: (id: string) => void; onopen: (id: string) => void;
    } = $props();

    const uid = $props.id();
    const rowHeight = 88;
    let list: HTMLDivElement;
    let scroll = $state(0), height = $state(0);
    let menu = $state(false), menuId = $state<string | null>(null), menuAt = $state({ x: 0, y: 0 });

    const rows = $derived(items.map(item => ({
        item,
        top: item.rectangles.reduce((top, rect) => Math.max(top, rect.y + rect.height), -Infinity)
    }))
        .sort((a, b) => a.item.pageNumber - b.item.pageNumber || b.top - a.top || a.item.id.localeCompare(b.item.id))
        .map(row => row.item));
    const indices = $derived(new Map(rows.map((item, index) => [item.id, index])));
    const selectedIndex = $derived(selectedId ? indices.get(selectedId) ?? -1 : -1);
    const start = $derived(Math.max(0, Math.min(rows.length - 1, Math.floor(scroll / rowHeight) - 3)));
    const end = $derived(Math.min(rows.length, Math.ceil((scroll + height) / rowHeight) + 3));
    const menuAnchor = $derived.by(() => {
        const { x, y } = menuAt;
        return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
    });
    const menuItems = $derived.by((): MenuItem[] => {
        const id = menuId, item = id ? rows[indices.get(id) ?? -1] : undefined;
        if (!item) return [];
        return [
            { label: t("reader.changeColor"), icon: "symbol-color", disabled: readOnly, items:
                (Object.keys(annotationColors) as (keyof typeof annotationColors)[]).map(color => ({
                    label: t(`color.${color}`), checked: item.color === color, onselect: () => oncolor(item.id, color)
                })) },
            { label: t("reader.openAnnotation"), shortcut: annotationShortcuts.openTab, onselect: () => onopen(item.id) },
            { label: t("reader.deleteAnnotation"), icon: "trash", shortcut: annotationShortcuts.remove, disabled: readOnly, onselect: () => onremove(item.id) }
        ];
    });

    function reveal(index: number, at: number): number {
        if (index < 0 || !list.clientHeight) return at;
        const top = index * rowHeight, bottom = top + rowHeight;
        return Math.min(top, Math.max(at, bottom - list.clientHeight));
    }

    let previousRows: PaperAnnotation[] = [], visibleSelection: string | null = null;
    $effect(() => {
        const next = rows, selected = selectedId, shown = visible;
        untrack(() => {
            if (!shown) menu = false;
            if (list) {
                let nextScroll = scroll;
                if (previousRows !== next && previousRows.length) {
                    const first = Math.floor(scroll / rowHeight);
                    const anchor = previousRows.slice(first).find(row => indices.has(row.id));
                    if (anchor) nextScroll = indices.get(anchor.id)! * rowHeight + scroll % rowHeight;
                }
                if (shown && visibleSelection !== selected) {
                    nextScroll = reveal(selectedIndex, nextScroll);
                    visibleSelection = selected;
                }
                scroll = nextScroll;
                if (shown && list.scrollTop !== nextScroll) void tick().then(() => {
                    if (list && visible && rows === next && scroll === nextScroll) list.scrollTop = nextScroll;
                });
            }
            previousRows = next;
        });
    });

    function move(index: number): void {
        const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
        if (row) onselect(row);
    }
    function bounds(id: string): DOMRect {
        return document.getElementById(uid + id)?.getBoundingClientRect() ?? list.getBoundingClientRect();
    }
    function edit(item: PaperAnnotation): void {
        const box = bounds(item.id);
        onselect(item, { x: box.left, y: box.bottom });
    }
    function context(item: PaperAnnotation, x: number, y: number): void {
        list.focus({ preventScroll: true });
        if (selectedId !== item.id) onselect(item);
        menuId = item.id;
        menuAt = { x, y };
        menu = true;
    }
    function keys(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event) || event.metaKey || event.altKey) return;
        const selected = rows[selectedIndex];
        if (event.key === annotationShortcuts.next && !event.ctrlKey && !event.shiftKey) move(selectedIndex + 1);
        else if (event.key === annotationShortcuts.previous && !event.ctrlKey && !event.shiftKey) move(selectedIndex < 0 ? rows.length - 1 : selectedIndex - 1);
        else if (selected) {
            const shortcut = `${event.ctrlKey ? "Ctrl+" : ""}${event.shiftKey ? "Shift+" : ""}${event.key}`;
            if (shortcut === annotationShortcuts.edit) edit(selected);
            else if (shortcut === annotationShortcuts.openTab) onopen(selected.id);
            else if (shortcut === annotationShortcuts.remove) {
                if (!readOnly) onremove(selected.id);
            }
            else if (shortcut === annotationShortcuts.menu || event.key === "ContextMenu") {
                const box = bounds(selected.id);
                context(selected, box.left, box.bottom);
            }
            else return;
        }
        else return;
        event.preventDefault();
        event.stopPropagation();
    }
</script>

<div class="annotation-list" role="listbox" tabindex={rows.length ? 0 : -1} aria-label={t("reader.annotations")}
    aria-activedescendant={selectedIndex >= start && selectedIndex < end ? uid + selectedId : undefined}
    bind:this={list} bind:clientHeight={height} onscroll={event => {
        if (visible) scroll = event.currentTarget.scrollTop;
    }} onkeydown={keys}>
    {#if rows.length}
        <div aria-hidden="true" style:height={start * rowHeight + "px"}></div>
        {#each rows.slice(start, end) as item, index (item.id)}
            <div role="option" tabindex="-1" id={uid + item.id} data-annotation-id={item.id} data-page-number={item.pageNumber}
                aria-posinset={start + index + 1} aria-setsize={rows.length} aria-selected={item.id === selectedId}
                class="annotation-row" style:height={rowHeight + "px"} onclick={() => {
                    list.focus({ preventScroll: true });
                    onselect(item);
                }} ondblclick={() => edit(item)} oncontextmenu={event => {
                    event.preventDefault();
                    context(item, event.clientX, event.clientY);
                }}>
                <span class="annotation-page"><span class="swatch" style:background={annotationColors[item.color].value}
                    aria-label={t(`color.${item.color}`)} role="img"></span>
                    {t("reader.annotationPage", { page: item.pageNumber })}</span>
                <span class="annotation-quote">{item.quote}</span>
                {#if item.hasText}<span class="annotation-excerpt">{item.excerpt}</span>{/if}
            </div>
        {/each}
        <div aria-hidden="true" style:height={(rows.length - end) * rowHeight + "px"}></div>
    {:else}<div data-paragraph>{t("reader.noAnnotations")}</div>{/if}
</div>
{#if visible}<Menu bind:open={menu} items={menuItems} anchor={menuAnchor} first onrestore={() => list?.focus({ preventScroll: true })} />{/if}

<style>
    .annotation-list {
        flex: 1; min-height: 0; min-width: 0; overflow: auto; overflow-anchor: none; isolation: isolate;
        background: var(--ui-surface-window); outline-offset: calc(-1 * var(--ui-focus-width));
        font-size: var(--ui-font-small); color: var(--ui-text-secondary);
    }
    .annotation-list :where([data-paragraph]) { margin: var(--ui-space-3); }
    .annotation-list:focus-visible { outline: var(--ui-focus-width) solid var(--ui-focus); }
    .annotation-row { padding: var(--ui-space-3) var(--ui-space-4); cursor: default; overflow: hidden; border-bottom: var(--ui-stroke) solid var(--ui-divider); }
    .annotation-row:hover { background: var(--ui-hover); }
    .annotation-row[aria-selected="true"] { background: var(--ui-selected-inactive); }
    .annotation-list:focus-within .annotation-row[aria-selected="true"] { background: var(--ui-selected); }
    .annotation-page { display: flex; align-items: center; gap: var(--ui-space-3); line-height: 16px; margin-bottom: var(--ui-space-2); }
    .swatch { width: var(--ui-icon-small); height: var(--ui-icon-small); border-radius: 50%; border: var(--ui-stroke) solid var(--ui-border); }
    .annotation-quote { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; line-height: 16px; color: var(--ui-text); }
    .annotation-excerpt { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 16px; }
</style>