<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { SvelteSet } from "svelte/reactivity";
    import { isComposingKey, libraryShortcuts } from "../../../shared/content/commands";
    import type { PageSummary } from "../../../shared/types/content";
    import type { LibraryColumn, LibraryIndex, LibrarySort } from "../../../shared/workspace/library";
    import Menu, { type MenuItem } from "../base/Menu.svelte";
    import Tooltip from "../base/Tooltip.svelte";
    import Icon from "../utils/Icon.svelte";
    import { t } from "../../i18n.svelte";
    import { kindIcons } from "./labels";
    import LibraryColumns from "./LibraryColumns.svelte";

    let { index, rows, columns, choices, sort, selected = $bindable(), pending, label, cell, onsort, oncolumns, onreset, onrange, actions, onopen, ondelete, onfiles }: {
        index: LibraryIndex; rows: ReadonlyMap<string, PageSummary>; columns: LibraryColumn[]; choices: string[]; sort: LibrarySort;
        selected: ReadonlySet<string>; pending: boolean; label: (id: string) => string; cell: (row: PageSummary, id: string) => string;
        onsort: (id: string) => void; oncolumns: (columns: LibraryColumn[]) => void; onreset: () => void;
        onrange: (first: number, last: number) => void; actions: (row: PageSummary) => { id: string; label: string; run: () => void }[];
        onopen: (ids: string[], side: boolean) => void; ondelete: () => void; onfiles?: (paths: string[], pageId?: string) => void;
    } = $props();
    const uid = $props.id();
    let grid: HTMLElement, ime: HTMLInputElement;
    let height = $state(0), rowHeight = $state(24), scroll = $state(0);
    let cursor = $state(""), anchor = "", prefix = "", typedAt = 0;
    function focusedId(): string {
        return index.ids.includes(cursor) ? cursor : selected.values().next().value ?? "";
    }
    const first = $derived(Math.max(0, Math.floor(scroll / (rowHeight || 24))));
    const count = $derived(Math.max(1, Math.ceil(height / (rowHeight || 24))));
    const buffer = $derived(first ? 12 : 2), step = $derived(first ? 6 : 1);
    const start = $derived(Math.max(0, Math.floor((first - buffer) / step) * step));
    const end = $derived(Math.min(index.ids.length, Math.ceil((first + count) / step) * step + buffer));
    const visible = $derived(index.ids.slice(start, end));
    const tracks = $derived(columns.map(c => c.width ? c.width + "px" : c.id === "title" ? "minmax(150px, 2fr)" : c.id === "paper_year" || c.id === "kind" ? "minmax(60px, .6fr)" : "minmax(98px, 1fr)").join(" "));
    const minWidth = $derived(columns.reduce((n, c) => n + (c.width ?? (c.id === "title" ? 150 : c.id === "paper_year" || c.id === "kind" ? 60 : 98)), 0));
    $effect(() => {
        const from = start, to = end;
        void index;
        untrack(() => onrange(from, to));
    });
    let queued: number | undefined;
    function scrollWindow(event: Event & { currentTarget: HTMLElement }): void {
        const viewport = event.currentTarget;
        if (viewport !== grid) return;
        hideTip();
        const at = viewport.scrollTop, row = Math.floor(at / rowHeight);
        if (row < start || Math.min(index.ids.length, row + count) > end) {
            scroll = at;
        }
        else if (queued === undefined) {
            // Chromium can finish the current wheel frame before we replenish the buffer.
            queued = requestIdleCallback(() => {
                queued = undefined;
                if (viewport === grid) scroll = viewport.scrollTop;
            }, { timeout: 24 });
        }
    }
    export function position(): { id: string; index: number; offset: number } {
        const at = grid?.scrollTop ?? 0, i = Math.floor(at / (rowHeight || 24));
        return { id: index.ids[i], index: i, offset: at % (rowHeight || 24) };
    }
    export function scrollToRow(i: number, offset = 0): void {
        if (grid) scroll = grid.scrollTop = Math.max(0, i) * rowHeight + offset;
    }
    export function selectAll(): void {
        selected = new SvelteSet(index.ids);
        if (!cursor) cursor = index.ids[0] ?? "";
        anchor = cursor;
    }
    function choose(i: number, extend = false, toggle = false): void {
        const id = index.ids[i];
        if (!id) return;
        const origin = index.ids.indexOf(anchor);
        if (extend && origin >= 0) selected = new SvelteSet(index.ids.slice(Math.min(origin, i), Math.max(origin, i) + 1));
        else {
            const next = new SvelteSet(toggle ? selected : []);
            if (toggle && next.has(id)) next.delete(id);
            else next.add(id);
            selected = next; anchor = id;
        }
        cursor = id;
    }
    function move(i: number, extend = false): void {
        i = Math.max(0, Math.min(index.ids.length - 1, i));
        choose(i, extend);
        const top = i * rowHeight, bottom = top + rowHeight * 2;
        if (top < grid.scrollTop) scroll = grid.scrollTop = top;
        else if (bottom > grid.scrollTop + grid.clientHeight) scroll = grid.scrollTop = bottom - grid.clientHeight;
    }
    function jump(text: string): void {
        if (!text) return;
        const now = performance.now(), continuing = now - typedAt < 1000 && !!prefix;
        prefix = (continuing ? prefix : "") + text.toLocaleLowerCase(); typedAt = now;
        const pos = Math.max(0, index.ids.indexOf(focusedId()) + (continuing ? 0 : 1));
        for (let i = 0; i < index.ids.length; i++) {
            const at = (pos + i) % index.ids.length;
            if ((index.titles[at] || t("shell.untitled")).toLocaleLowerCase().startsWith(prefix)) {
                move(at); return;
            }
        }
    }
    let menu = $state(false), point = $state({ x: 0, y: 0 }), contextRow = $state.raw<PageSummary>();
    const menuAnchor = { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) };
    const menuItems = $derived<MenuItem[]>(menu && contextRow ? actions(contextRow).map(a => ({ label: a.label, shortcut: libraryShortcuts[a.id as keyof typeof libraryShortcuts], onselect: a.run })) : []);
    function context(i: number, x: number, y: number): void {
        const row = rows.get(index.ids[i]);
        if (!row) return;
        if (!selected.has(row.id)) choose(i);
        cursor = row.id; contextRow = row; point = { x, y }; menu = true;
    }
    function keys(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event) || (event.target !== ime && event.target !== grid)) return;
        const i = index.ids.indexOf(focusedId()), key = event.key;
        if (event.ctrlKey && key.toLowerCase() === "a") selectAll();
        else if (key === "Enter" && !event.shiftKey && selected.size) onopen([...selected], event.ctrlKey);
        else if (key === "Delete" && selected.size) ondelete();
        else if (event.ctrlKey && event.shiftKey && (key === "Enter" || key.toLowerCase() === "k")) {
            const row = rows.get(focusedId());
            if (row) actions(row).find(a => a.id === (key === "Enter" ? "restore" : "pin"))?.run();
        }
        else if (key === "ContextMenu" || (event.shiftKey && key === "F10")) {
            const row = document.getElementById(uid + focusedId())?.getBoundingClientRect() ?? grid.getBoundingClientRect();
            if (i >= 0) context(i, row.left, row.bottom);
        }
        else if (event.ctrlKey || event.altKey || event.metaKey) return;
        else if (key === "ArrowDown" || key === "ArrowUp") move(i + (key === "ArrowDown" ? 1 : -1), event.shiftKey);
        else if (key === "Home" || key === "End") move(key === "Home" ? 0 : index.ids.length - 1, event.shiftKey);
        else if (key === "PageDown" || key === "PageUp") move(i + (key === "PageDown" ? 1 : -1) * Math.max(1, count - 1), event.shiftKey);
        else if (Array.from(key).length === 1) jump(key);
        else return;
        event.preventDefault(); event.stopPropagation();
    }
    let tip = $state<HTMLElement>(), hover: HTMLElement | undefined, timer: ReturnType<typeof setTimeout>;
    function hideTip(): void {
        clearTimeout(timer); hover = undefined; tip = undefined;
    }
    function inspect(event: PointerEvent): void {
        const el = (event.target as Element).closest<HTMLElement>("[role=gridcell] .cell-label");
        if (el === hover) return;
        hideTip();
        if (el && el.scrollWidth > el.clientWidth) {
            hover = el; timer = setTimeout(() => {
                if (el.isConnected) tip = el;
            }, 450);
        }
    }
    let over = $state<string | null>(null);
    function target(event: DragEvent): string | null {
        const transfer = event.dataTransfer;
        if (!onfiles || !transfer?.types.includes("Files")) return null;
        const row = (event.target as Element).closest<HTMLElement>("[data-kind=paper]");
        if (row) {
            const box = row.getBoundingClientRect(), edge = Math.min(4, box.height / 5);
            if (event.clientY >= box.top + edge && event.clientY < box.bottom - edge) return row.dataset.pageId!;
        }
        const files = Array.from(transfer.files);
        const pdf = files.length ? files.some(file => /\.pdf$/iu.test(file.name)) : Array.from(transfer.items).some(item => item.kind === "file" && (!item.type || item.type === "application/pdf"));
        return pdf ? "" : null;
    }
    function drag(event: DragEvent): void {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault(); event.stopPropagation(); over = target(event);
        event.dataTransfer.dropEffect = over === null ? "none" : "copy";
    }
    function dropFiles(event: DragEvent): void {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault(); event.stopPropagation();
        const where = target(event); over = null;
        if (where !== null) onfiles?.(Array.from(event.dataTransfer.files, file => window.getPathForFile(file)), where || undefined);
    }
    onDestroy(() => {
        hideTip();
        if (queued !== undefined) cancelIdleCallback(queued);
    });
</script>

<div class="library-grid" class:drop-zone={over !== null} ondragover={drag} ondrop={dropFiles} ondragleave={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) over = null;
}} bind:this={grid} bind:clientHeight={height} role="grid" tabindex="0" aria-label={t("command.library")}
    aria-rowcount={index.ids.length + 1} aria-colcount={columns.length} aria-multiselectable="true" aria-busy={pending}
    aria-activedescendant={visible.includes(cursor) ? uid + cursor : undefined} style:--library-tracks={tracks} style:--library-min-width={minWidth + "px"}
    onfocus={event => {
        if (event.target === grid) ime?.focus({ preventScroll: true });
    }} onkeydown={keys}
    onscroll={scrollWindow} onpointerover={inspect} onpointerleave={hideTip}>
    <input class="ime" data-library-keyboard bind:this={ime} tabindex="-1" aria-label={t("command.library")} autocomplete="off"
        oncompositionend={event => {
            jump(event.data); event.currentTarget.value = "";
        }}
        oninput={event => {
            if (!(event instanceof InputEvent && event.isComposing)) event.currentTarget.value = "";
        }} />
    <div class="row-metric" aria-hidden="true" bind:offsetHeight={rowHeight}></div>
    <LibraryColumns {columns} {choices} {sort} {label} {onsort} onchange={oncolumns} {onreset} />
    <div aria-hidden="true" style:height={start * rowHeight + "px"}></div>
    {#each visible as id, n (id)}
        {@const row = rows.get(id)}
        <div class="library-row" class:drop-row={over === id} data-page-id={id} data-kind={row?.kind} id={uid + id} role="row" aria-rowindex={start + n + 2} aria-selected={selected.has(id)}
            tabindex="-1" onclick={event => {
                ime.focus({ preventScroll: true }); choose(start + n, event.shiftKey, event.ctrlKey);
            }} onkeydown={keys}
            ondblclick={event => onopen([id], event.ctrlKey)} oncontextmenu={event => {
                event.preventDefault(); context(start + n, event.clientX, event.clientY);
            }}>
            {#each columns as column (column.id)}
                <span data-column={column.id} role="gridcell">
                    {#if column.id === "title" && row}<Icon name={kindIcons[row.kind]} size="var(--ui-icon-normal)" />{/if}
                    <span class="cell-label">{row ? cell(row, column.id) : column.id === "title" ? index.titles[start + n] : ""}</span>
                </span>
            {/each}
        </div>
    {/each}
    <div aria-hidden="true" style:height={Math.max(0, index.ids.length - end) * rowHeight + "px"}></div>
    {#if !index.ids.length}<div data-paragraph>{t(pending ? "library.loading" : "library.empty")}</div>{/if}
</div>
<Menu bind:open={menu} items={menuItems} anchor={menuAnchor} first onrestore={() => ime?.focus({ preventScroll: true })} />
{#if tip}<Tooltip text={tip.textContent ?? ""} anchor={tip} open />{/if}

<style>
    /* An opaque scrolling surface lets Chromium hit-test wheel input on the compositor. */
    .library-grid { flex: 1; min-height: 0; min-width: 0; overflow: auto; background: var(--ui-surface-window); overflow-anchor: none; isolation: isolate; position: relative; outline-offset: calc(-1 * var(--ui-focus-width)); }
    .library-grid.drop-zone { outline: var(--ui-active-border) solid var(--ui-selected); outline-offset: calc(-1 * var(--ui-active-border)); }
    .library-row.drop-row { background: var(--ui-selected); outline: var(--ui-stroke) dashed var(--ui-accent); outline-offset: calc(-1 * var(--ui-stroke)); }
    .ime, .row-metric { position: absolute; pointer-events: none; width: 1px; }
    .ime { opacity: 0; height: 1px; padding: 0; border: 0; }
    .row-metric { visibility: hidden; height: var(--ui-row-height); }
    .library-row { display: grid; grid-template-columns: var(--library-tracks); min-width: var(--library-min-width); width: 100%; height: var(--ui-row-height); font-size: var(--ui-font-small); cursor: default; user-select: none; }
    .library-row:hover { background: var(--ui-hover); }
    .library-row[aria-selected="true"] { background: var(--ui-selected-inactive); color: var(--ui-text-selected); }
    .library-grid:focus-within .library-row[aria-selected="true"] { background: var(--ui-selected); }
    [role="gridcell"] { display: flex; gap: var(--ui-space-2); align-items: center; padding-inline: var(--ui-space-3); min-width: 0; overflow: hidden; }
    .cell-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    :where([data-paragraph]) { padding: var(--ui-space-3); color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
</style>