<script lang="ts">
    import { onDestroy, untrack, type Snippet } from "svelte";
    import { SvelteSet } from "svelte/reactivity";
    import { isComposingKey, tableShortcuts } from "../../../shared/content/commands";
    import type { PageSummary } from "../../../shared/types/content";
    import type { GroupValue, ViewSort } from "../../../shared/workspace/query";
    import type { TableColumn } from "../../../shared/workspace/table";
    import Menu, { type MenuItem } from "../base/Menu.svelte";
    import Button from "../base/Button.svelte";
    import Tooltip from "../base/Tooltip.svelte";
    import Icon from "../utils/Icon.svelte";
    import { t } from "../../i18n.svelte";
    import { kindIcons } from "./labels";
    import TableColumns from "./TableColumns.svelte";
    import type { TableGroup, TablePage, TablePosition, TableRows } from "./table-rows";

    let { layout, rows, columns, choices, sort, selected = $bindable(), pending, label, cell, groupLabel, onsort, oncolumns, onreset, onrange,
        ongroup, actions, onopen, ondelete, onfiles, onedit, editor, title }: {
        layout: TableRows; rows: ReadonlyMap<string, PageSummary>; columns: TableColumn[]; choices: string[]; sort: ViewSort[];
        selected: ReadonlySet<string>; pending: boolean; label: (id: string) => string; cell: (row: PageSummary, id: string) => string;
        groupLabel: (value: GroupValue) => string; title: string;
        onsort: (id: string, extend: boolean) => void; oncolumns: (columns: TableColumn[]) => void; onreset: () => void;
        onrange: (first: number, last: number) => void; ongroup: (value: GroupValue, collapsed: boolean) => void;
        actions: (row: PageSummary) => { id: string; label: string; run: () => void }[];
        onopen: (ids: string[], side: boolean) => void; ondelete: () => void;
        onfiles?: (paths: string[], pageId?: string, group?: GroupValue) => void;
        onedit?: (row: TablePage, column: string) => void;
        editor?: Snippet<[row: TablePage, column: string, value: PageSummary | undefined, contents: Snippet]>;
    } = $props();
    const uid = $props.id();
    let grid: HTMLElement, ime: HTMLInputElement;
    let height = $state(0), measured = $state(0), scroll = $state(0);
    const rowHeight = $derived(measured || 24);
    let cursor = $state(""), anchor = "", prefix = "", typedAt = 0;

    function focusedIndex(): number {
        return layout.positions.get(cursor) ?? layout.firstOccurrences.get(selected.values().next().value ?? "") ?? -1;
    }
    const first = $derived(Math.max(0, Math.floor(scroll / rowHeight)));
    const count = $derived(Math.max(1, Math.ceil(height / rowHeight)));
    const buffer = $derived(first ? 12 : 2), step = $derived(first ? 6 : 1);
    const start = $derived(Math.max(0, Math.floor((first - buffer) / step) * step));
    const end = $derived(Math.min(layout.items.length, Math.ceil((first + count) / step) * step + buffer));
    const visible = $derived(layout.items.slice(start, end));
    const sticky = $derived.by(() => {
        const row = layout.items[first];
        return row?.kind === "page" && row.group !== undefined ? layout.groups.get(row.group) : undefined;
    });
    const stickyOffset = $derived(sticky ? Math.min(0, sticky.end * rowHeight - scroll - rowHeight) : 0);
    const tracks = $derived(columns.map(c => c.width ? c.width + "px" : c.id === "title" ? "minmax(150px, 2fr)" : c.id === "paper_year" || c.id === "kind" ? "minmax(60px, .6fr)" : "minmax(98px, 1fr)").join(" "));
    const minWidth = $derived(columns.reduce((n, c) => n + (c.width ?? (c.id === "title" ? 150 : c.id === "paper_year" || c.id === "kind" ? 60 : 98)), 0));
    $effect(() => {
        const from = start, to = end;
        void layout;
        untrack(() => onrange(from, to));
    });
    let queued: number | undefined;
    function scrollWindow(event: Event & { currentTarget: HTMLElement }): void {
        const viewport = event.currentTarget;
        if (viewport !== grid) return;
        hideTip();
        const at = viewport.scrollTop, row = Math.floor(at / rowHeight);
        if (row < start || Math.min(layout.items.length, row + count) > end) scroll = at;
        else if (queued === undefined) {
            // Replenish the buffer after Chromium can finish the current wheel frame.
            queued = requestIdleCallback(() => {
                queued = undefined;
                if (viewport === grid) scroll = viewport.scrollTop;
            }, { timeout: 24 });
        }
    }
    export function position(): TablePosition {
        const at = grid?.scrollTop ?? 0, i = Math.floor(at / rowHeight), row = layout.items[i];
        return { key: row?.key, id: row?.kind === "page" ? row.id : undefined, index: i, offset: at % rowHeight };
    }
    export function viewportSize(): number {
        return count + 12;
    }
    export function restorePosition(i: number, offset = 0): void {
        if (grid) scroll = grid.scrollTop = Math.max(0, i) * rowHeight + offset;
    }
    export function selectAll(): void {
        selected = new SvelteSet(layout.ids);
        if (!cursor) cursor = layout.items[0]?.key ?? "";
        anchor = cursor;
    }
    export function selectedGroup(): GroupValue | undefined {
        if (!selected.size) return undefined;
        const row = layout.items[focusedIndex()];
        if (row?.kind === "page" && selected.has(row.id)) return row.group;
        const selectedRow = layout.items[layout.firstOccurrences.get(selected.values().next().value ?? "") ?? -1];
        return selectedRow?.kind === "page" ? selectedRow.group : row?.kind === "group" ? row.value : undefined;
    }
    export function focusPage(id: string): TablePage | undefined {
        const i = layout.firstOccurrences.get(id);
        if (i === undefined) return;
        move(i);
        focusGrid();
        const row = layout.items[i];
        return row?.kind === "page" ? row : undefined;
    }
    export function focusGrid(): void {
        ime?.focus({ preventScroll: true });
    }
    function choose(i: number, extend = false, toggle = false): void {
        const row = layout.items[i];
        if (!row) return;
        cursor = row.key;
        if (row.kind === "group") return;
        const origin = layout.positions.get(anchor);
        if (extend && origin !== undefined) {
            const ids = new SvelteSet<string>();
            for (let at = Math.min(origin, i); at <= Math.max(origin, i); at++) {
                const item = layout.items[at];
                if (item.kind === "page") ids.add(item.id);
            }
            selected = ids;
        }
        else {
            const next = new SvelteSet(toggle ? selected : []);
            if (toggle && next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
            selected = next;
            anchor = row.key;
        }
    }
    function reveal(i: number): void {
        const row = layout.items[i], header = row?.kind === "page" && row.group !== undefined ? 1 : 0;
        const top = (i - header) * rowHeight, bottom = (i + 2) * rowHeight;
        if (top < grid.scrollTop) scroll = grid.scrollTop = Math.max(0, top);
        else if (bottom > grid.scrollTop + grid.clientHeight) scroll = grid.scrollTop = bottom - grid.clientHeight;
    }
    function move(i: number, extend = false, direction = 1): void {
        const last = layout.items.length - 1;
        i = Math.max(0, Math.min(last, i));
        if (extend) {
            let next = i;
            while (next >= 0 && next <= last && layout.items[next].kind === "group") next += direction;
            if (next < 0 || next > last) return;
            i = next;
        }
        choose(i, extend);
        if (last >= 0) reveal(i);
    }
    function jump(text: string): void {
        if (!text) return;
        const now = performance.now(), continuing = now - typedAt < 1000 && !!prefix;
        prefix = (continuing ? prefix : "") + text.toLocaleLowerCase(); typedAt = now;
        const pos = Math.max(0, focusedIndex() + (continuing ? 0 : 1)), items = layout.items;
        for (let i = 0; i < items.length; i++) {
            const at = (pos + i) % items.length, row = items[at];
            if (row.kind === "page" && ((rows.get(row.id)?.title ?? row.title) || t("shell.untitled")).toLocaleLowerCase().startsWith(prefix)) {
                move(at); return;
            }
        }
    }
    let menu = $state(false), point = $state({ x: 0, y: 0 }), contextRow = $state.raw<PageSummary>(), contextEntry = $state.raw<TablePage>();
    const menuAnchor = { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) };
    const menuItems = $derived<MenuItem[]>(menu && contextRow ? [
        ...actions(contextRow).map(a => ({ label: a.label, shortcut: tableShortcuts[a.id as keyof typeof tableShortcuts], onselect: a.run })),
        ...(onedit && selected.size === 1 && contextEntry ? [{ label: t("table.editTitle"), shortcut: tableShortcuts.editTitle, onselect: () => onedit?.(contextEntry!, "title") }] : [])
    ] : []);
    function context(i: number, x: number, y: number): void {
        const entry = layout.items[i];
        if (entry?.kind !== "page") return;
        const row = rows.get(entry.id);
        if (!row) return;
        if (!selected.has(row.id)) choose(i);
        cursor = entry.key; contextEntry = entry; contextRow = row; point = { x, y }; menu = true;
    }
    function toggleGroup(group: TableGroup, collapsed = !group.collapsed): void {
        cursor = group.key;
        ongroup(group.value, collapsed);
        focusGrid();
    }
    function keys(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event) || (event.target !== ime && event.target !== grid)) return;
        if (event.altKey || event.metaKey) return;
        const i = focusedIndex(), entry = layout.items[i], key = event.key, { ctrlKey, shiftKey } = event;
        const shortcuts = tableShortcuts, group = entry?.kind === "group" ? entry : entry?.group !== undefined ? layout.groups.get(entry.group) : undefined;
        if (ctrlKey && !shiftKey && key.toLowerCase() === "a") selectAll();
        else if (key === shortcuts.open && !shiftKey && selected.size) onopen([...selected], ctrlKey);
        else if (key === shortcuts.editTitle && !ctrlKey && !shiftKey && selected.size === 1 && onedit) {
            const page = entry?.kind === "page" && selected.has(entry.id) ? entry : layout.items[layout.firstOccurrences.get(selected.values().next().value ?? "") ?? -1];
            if (page?.kind === "page") onedit(page, "title");
        }
        else if (key === shortcuts.trash && selected.size) ondelete();
        else if (ctrlKey && shiftKey && (key === "Enter" || key.toLowerCase() === "k")) {
            const row = entry?.kind === "page" && rows.get(entry.id);
            if (row) actions(row).find(a => a.id === (key === "Enter" ? "restore" : "pin"))?.run();
        }
        else if (key === "ContextMenu" || (shiftKey && key === "F10")) {
            const row = grid.querySelector<HTMLElement>("[aria-rowindex=\"" + (i + 2) + "\"]")?.getBoundingClientRect() ?? grid.getBoundingClientRect();
            if (i >= 0) context(i, row.left, row.bottom);
        }
        else if (ctrlKey || event.altKey || event.metaKey) return;
        else if (group && (key === shortcuts.collapse || key === shortcuts.expand)) toggleGroup(group, key === shortcuts.collapse);
        else if (key === shortcuts.next || key === shortcuts.previous) {
            const step = key === shortcuts.next ? 1 : -1;
            move(i + step, shiftKey, step);
        }
        else if (key === shortcuts.first || key === shortcuts.last) move(key === shortcuts.first ? 0 : layout.items.length - 1, shiftKey, key === shortcuts.first ? 1 : -1);
        else if (key === shortcuts.screenDown || key === shortcuts.screenUp) {
            const step = key === shortcuts.screenDown ? 1 : -1;
            move(i + step * Math.max(1, count - 1), shiftKey, step);
        }
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
        if (where === null) return;
        const key = (event.target as Element).closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
        const entry = key ? layout.items[layout.positions.get(key) ?? -1] : undefined;
        const group = entry?.kind === "group" ? entry.value : entry?.group;
        onfiles?.(Array.from(event.dataTransfer.files, file => window.getPathForFile(file)), where || undefined, group);
    }
    onDestroy(() => {
        hideTip();
        if (queued !== undefined) cancelIdleCallback(queued);
    });
</script>

{#snippet groupHeader(entry: TableGroup, clone = false)}
    <Button class="group-header" variant="text" icon={entry.collapsed ? "chevron-right" : "chevron-down"} data-row-key={entry.key}
        aria-expanded={!entry.collapsed} tabindex={clone ? -1 : 0} onclick={() => toggleGroup(entry)} onkeydown={event => {
            if (isComposingKey(event)) {
                if (event.key === "Enter" || event.key === " ") event.preventDefault();
                return;
            }
            if (event.key === tableShortcuts.collapse || event.key === tableShortcuts.expand) {
                event.preventDefault();
                toggleGroup(entry, event.key === tableShortcuts.collapse);
            }
        }}>
        <span>{groupLabel(entry.value)}</span>
        <span class="group-count">{entry.count}</span>
    </Button>
{/snippet}

<div class="library-grid" class:drop-zone={over !== null} ondragover={drag} ondrop={dropFiles} ondragleave={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) over = null;
}} bind:this={grid} bind:clientHeight={height} role="grid" tabindex="0" aria-label={title}
    aria-rowcount={layout.items.length + 1} aria-colcount={columns.length} aria-multiselectable="true" aria-busy={pending}
    aria-activedescendant={cursor && visible.some(entry => entry.key === cursor) ? uid + layout.positions.get(cursor) : undefined}
    style:--library-tracks={tracks} style:--library-min-width={minWidth + "px"}
    onfocus={event => {
        if (event.target === grid) focusGrid();
    }} onkeydown={keys} onscroll={scrollWindow} onpointerover={inspect} onpointerleave={hideTip}>
    <input class="ime" data-library-keyboard bind:this={ime} tabindex="-1" aria-label={title} autocomplete="off"
        oncompositionend={event => {
            jump(event.data); event.currentTarget.value = "";
        }}
        oninput={event => {
            if (!(event instanceof InputEvent && event.isComposing)) event.currentTarget.value = "";
        }} />
    <div class="row-metric" aria-hidden="true" bind:offsetHeight={measured}></div>
    <TableColumns {columns} {choices} {sort} {label} {onsort} onchange={oncolumns} {onreset} />
    {#if sticky}<div class="sticky-group" aria-hidden="true" style:--group-offset={stickyOffset + "px"}>{@render groupHeader(sticky, true)}</div>{/if}
    <div aria-hidden="true" style:height={start * rowHeight + "px"}></div>
    {#each visible as entry, n (entry.key)}
        {@const i = start + n}
        {#if entry.kind === "group"}
            <div class="group-row" class:cursor={cursor === entry.key} id={uid + i} role="row" aria-rowindex={i + 2}>
                <div role="gridcell" aria-colspan={columns.length}>{@render groupHeader(entry)}</div>
            </div>
        {:else}
            {@const id = entry.id}
            {@const row = rows.get(id)}
            <div class="library-row" class:drop-row={over === id} data-page-id={id} data-row-key={entry.key} data-kind={row?.kind} id={uid + i}
                role="row" aria-rowindex={i + 2} aria-selected={selected.has(id)} tabindex="-1"
                onclick={event => {
                    const target = event.target as Element;
                    if (target.closest("[data-cell-editor]")) return;
                    const column = target.closest<HTMLElement>("[data-column]")?.dataset.column;
                    const edit = column && selected.size === 1 && selected.has(id) && !event.shiftKey && !event.ctrlKey && event.detail < 2;
                    focusGrid(); choose(i, event.shiftKey, event.ctrlKey);
                    if (edit) onedit?.(entry, column);
                }} onkeydown={keys} ondblclick={event => {
                    if (!(event.target as Element).closest("[data-cell-editor]")) onopen([id], event.ctrlKey);
                }} oncontextmenu={event => {
                    if ((event.target as Element).closest("[data-cell-editor]")) return;
                    event.preventDefault(); context(i, event.clientX, event.clientY);
                }}>
                {#each columns as column (column.id)}
                    <div class="page-cell" data-column={column.id} role="gridcell">
                        {#snippet contents()}
                            {#if column.id === "title" && row}<Icon name={kindIcons[row.kind]} size="var(--ui-icon-normal)" />{/if}
                            <span class="cell-label">{row ? cell(row, column.id) : column.id === "title" ? entry.title : ""}</span>
                        {/snippet}
                        {#if editor}{@render editor(entry, column.id, row, contents)}{:else}{@render contents()}{/if}
                    </div>
                {/each}
            </div>
        {/if}
    {/each}
    <div aria-hidden="true" style:height={Math.max(0, layout.items.length - end) * rowHeight + "px"}></div>
    {#if !layout.ids.size && !pending}<div data-paragraph>{t("library.empty")}</div>{/if}
</div>
<Menu bind:open={menu} items={menuItems} anchor={menuAnchor} first onrestore={() => {
    if (!document.activeElement?.closest("[data-cell-editor]")) focusGrid();
}} />
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
    .page-cell { display: flex; gap: var(--ui-space-2); align-items: center; padding-inline: var(--ui-space-3); min-width: 0; overflow: hidden; }
    .cell-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .group-row { min-width: var(--library-min-width); height: var(--ui-row-height); background: var(--ui-surface-panel); }
    .group-row.cursor { color: var(--ui-text-selected); background: var(--ui-selected); }
    .sticky-group { position: sticky; top: var(--ui-row-height); z-index: 1; height: 0; min-width: var(--library-min-width); transform: translateY(var(--group-offset)); }
    .sticky-group :global(button) { background: var(--ui-surface-panel); }
    :global(button.group-header) { width: 100%; justify-content: flex-start; padding-inline: var(--ui-space-3); height: var(--ui-row-height); font-size: var(--ui-font-small); border-radius: 0; }
    .group-count { color: var(--ui-text-secondary); }
    :where([data-paragraph]) { padding: var(--ui-space-3); color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
</style>