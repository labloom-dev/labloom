<script module lang="ts">
    import { tabState } from "../Tab/state.svelte";
    import type { Tab } from "../Tab/defs";
    type Location = { selected: ReadonlySet<string>; keyword: string; top?: { id: string; index: number; offset: number } };
    // Splitting/moving a group remounts its components, but keeps its tab objects.
    const locations = new WeakMap<Tab, Location>();
    function tabLocation(tabId: string): Location {
        const tab = tabState.groups.flatMap(group => group.tabs).find(tab => tab.id === tabId);
        const saved = tab && locations.get(tab);
        if (saved) return saved;
        const fresh: Location = { selected: new Set(), keyword: "" };
        if (tab) locations.set(tab, fresh);
        return fresh;
    }
</script>

<script lang="ts">
    import { onMount, tick, untrack } from "svelte";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import { libraryText } from "../../../shared/attrs/format";
    import { validateValue } from "../../../shared/attrs/values";
    import { isTimeType } from "../../../shared/content/time";
    import type { AttributeDefinition, AttributeValue } from "../../../shared/types/attributes";
    import type { PageSummary } from "../../../shared/types/content";
    import { defaultColumns, defaultLibrary, libraryBatchSize, repairLibraryFields, type LibraryIndex, type LibraryQuery } from "../../../shared/workspace/library";
    import type { ViewParams } from "../../../shared/workspace/views";
    import { currentLanguage, failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Icon from "../utils/Icon.svelte";
    import { registerEditing } from "../layout/commands";
    import { createPage, openPage } from "../layout/navigation";
    import { currentTimeZone } from "../layout/preferences.svelte";
    import { visits } from "../Tab/activity.svelte";
    import type { ViewProps } from "../Tab/views";
    import { copyData } from "../copy-data";
    import { propertyName } from "./attribute-labels";
    import { pageMenu } from "./page-menu";
    import { registerPageView } from "./page-visits";
    import { write } from "./page-sessions";
    import { confirmed } from "./confirmation.svelte";
    import { purgePages } from "./purge";
    import Resizer from "../utils/Resizer.svelte";
    import PageInformation from "./PageInformation.svelte";
    import LibraryGrid from "./LibraryGrid.svelte";
    import { importedPages, importPapers } from "./library-import.svelte";
    import LibraryFilters from "./LibraryFilters.svelte";
    import LibraryToolbar from "./LibraryToolbar.svelte";

    type Params = ViewParams["library"];
    let { tabId, params, onparams, source }: ViewProps<"library"> = $props();
    const location = untrack(() => tabLocation(tabId));
    let root: HTMLElement, grid: LibraryGrid;
    let index = $state.raw<LibraryIndex>({ ids: [], titles: [] }), definitions = $state.raw<AttributeDefinition[]>([]);
    const rows = new SvelteMap<string, PageSummary>();
    let names = $state.raw<Record<string, string>>({}), selected = $state.raw<ReadonlySet<string>>(location.selected);
    let pending = $state(true), busy = $state(false), error = $state<ErrorValue>(""), keyword = $state(location.keyword), applied = $state(location.keyword);
    $effect(() => {
        location.selected = selected;
        location.keyword = keyword;
    });
    let subscriptions: ReturnType<typeof registerPageView> | undefined;
    let generation = 0, schemaDirty = true, alive = true, loading = new SvelteSet<string>();
    const defs = $derived(new Map(definitions.map(d => [d.id, d])));
    const availableAttrs = $derived(new Set(definitions.filter(d => !d.hidden).map(d => d.id)));
    const choices = $derived(["title", "kind", ...availableAttrs]);
    const columns = $derived((params.columns ?? defaultColumns(!!params.paperOnly)).filter(c => !definitions.length || choices.includes(c.id)));
    const sort = $derived(params.sort), zone = $derived(currentTimeZone());
    const filters = $derived(Object.fromEntries(params.filters.map(f => [f.attribute.id, f.value])));
    const userFiltered = $derived(!!(params.tags.length || params.filters.length || (!params.paperOnly && params.pageType)));
    const query = $derived<LibraryQuery>({ keyword: applied, kind: params.paperOnly ? "paper" : params.pageType?.type,
        sort, deleted: params.scope === "trash", ...(params.scope === "pinned" ? { pinned: true } : {}), tags: params.tags, attributes: filters, language: currentLanguage() });
    const queryKey = $derived(JSON.stringify(query)), columnKey = $derived(columns.map(c => c.id).join("\n"));
    let bodyWidth = $state(0), detail = $state("");
    const paneWidth = $derived(Math.min(bodyWidth * .8, params.infoWidth ?? bodyWidth / 3));
    const single = $derived(params.showProperties !== false && selected.size === 1 ? [...selected][0] : "");
    $effect(() => {
        const id = single;
        detail = "";
        if (!id) return;
        const timer = setTimeout(() => detail = id, 80);
        return () => clearTimeout(timer);
    });
    let lastQuery = $state(""), lastColumns = "";
    $effect(() => {
        const target = keyword;
        const timer = setTimeout(() => applied = target, 200);
        return () => clearTimeout(timer);
    });
    function change(patch: Partial<Params>): void {
        onparams({ ...params, ...patch });
    }
    function label(id: string): string {
        if (id === "title") return t("quickOpen.title");
        if (id === "kind") return t("library.type");
        if (id === "created_at") return t("library.added");
        if (id === "paper_year") return t("library.year");
        if (id === "paper_venue") return t("library.venue");
        const def = defs.get(id);
        return def ? propertyName(def) : id;
    }
    function valueText(id: string, value: AttributeValue | undefined): string {
        const def = defs.get(id);
        return def ? libraryText(def, value, currentLanguage(), zone, t, names) : "";
    }
    function cell(page: PageSummary, id: string): string {
        if (id === "title") return page.title || t("shell.untitled");
        if (id === "kind") return t(`library.${page.kind}`);
        return valueText(id, page.attributes[id]);
    }
    function sortBy(id: string): void {
        const type = defs.get(id)?.type;
        const desc = sort.column === id ? sort.direction === "asc" : !!type && isTimeType(type);
        change({ sort: { column: id, direction: desc ? "desc" : "asc" } });
    }
    async function fetchRows(ids: string[], version: number, refresh?: ReadonlySet<string>): Promise<void> {
        const batch = loading, needed = ids.filter(id => !batch.has(id) && (!rows.has(id) || refresh?.has(id)));
        if (!needed.length) return;
        needed.forEach(id => batch.add(id));
        try {
            const updates = await window.api.pages.listUpdates({ ids: needed, limit: needed.length, deleted: query.deleted }, [], columns.map(c => c.id));
            if (!alive || generation !== version) return;
            if (updates.names) names = { ...names, ...updates.names };
            for (const page of updates.items) rows.set(page.id, page);
        }
        finally {
            needed.forEach(id => batch.delete(id));
        }
    }
    function range(first: number, end: number): void {
        const version = generation;
        const from = Math.floor(first / libraryBatchSize) * libraryBatchSize, to = Math.ceil((end + 12) / libraryBatchSize) * libraryBatchSize;
        void fetchRows(index.ids.slice(from, to), version).catch(problem => {
            if (alive && generation === version) error = failure(problem);
        });
    }
    async function load(ids: string[], initial: boolean): Promise<void> {
        const key = queryKey, fields = columnKey, version = ++generation;
        const reset = key !== lastQuery, schema = schemaDirty, at = !lastQuery ? location.top : reset ? undefined : grid?.position();
        loading = new SvelteSet();
        pending = initial || !index.ids.length;
        try {
            if (schema) {
                const next = await window.api.attributes.definitions();
                if (!alive) return;
                definitions = next; schemaDirty = false;
            }
            const repaired = repairLibraryFields(params, availableAttrs);
            if (repaired !== params) {
                onparams(repaired);
                await tick();
                subscriptions?.refresh();
                return;
            }
            try {
                for (const [id, value] of Object.entries(filters)) {
                    const def = defs.get(id);
                    if (def) validateValue(def, value);
                }
            }
            catch {
                onparams(defaultLibrary(params.paperOnly));
                return;
            }
            const changed = new Set(ids), refreshAll = fields !== lastColumns || schema;
            const initialColumns = !lastQuery && !at?.index ? columns.map(c => c.id) : undefined;
            const { initial: firstRows, ...next } = await window.api.pages.libraryIndex(copyData(query), initialColumns);
            if (!alive || key !== queryKey) return;
            for (const page of firstRows ?? []) rows.set(page.id, page);
            const positions = new Set(next.ids);
            const anchor = at?.id ? next.ids.indexOf(at.id) : -1;
            const first = anchor >= 0 ? anchor : Math.max(0, Math.min(at?.index ?? 0, next.ids.length - 1));
            const viewport = next.ids.slice(Math.max(0, first - 2), first + libraryBatchSize), kept = new Set(viewport);
            if (!firstRows || first > 0) await fetchRows(viewport, version, refreshAll ? kept : changed);
            if (!alive || key !== queryKey) return;
            for (const id of rows.keys()) {
                if (!positions.has(id) || (!kept.has(id) && (refreshAll || changed.has(id)))) rows.delete(id);
            }
            if (next.names) names = { ...names, ...next.names };
            index = next;
            if ([...selected].some(id => !positions.has(id))) selected = new SvelteSet([...selected].filter(id => positions.has(id)));
            lastQuery = key; lastColumns = fields;
            await tick();
            if (reset || (at && grid?.position().id !== at.id)) grid?.scrollToRow(first, at?.offset);
            error = "";
        }
        catch (problem) {
            error = failure(problem);
            throw problem;
        }
        finally {
            if (alive && generation === version) pending = false;
        }
    }
    onMount(() => {
        const offEditing = registerEditing(root, command => {
            if (command === "selectAll") grid.selectAll();
        });
        subscriptions = registerPageView(tabId, {
            changed(event) {
                schemaDirty ||= !!event.definition;
                return [...(event.summaryPages ?? event.pages), ...(event.purged ?? []), ...(event.definition ? [event.definition] : [])];
            }, read: load
        });
        return () => {
            if (index.ids.length) location.top = grid?.position() ?? location.top;
            alive = false; subscriptions?.(); offEditing();
        };
    });
    $effect(() => {
        void queryKey; void columnKey; void zone;
        untrack(() => subscriptions?.refresh());
    });
    function open(ids: string[], side: boolean): void {
        ids.forEach((id, i) => openPage(id, { currentGroup: true, otherGroup: side && i === 0 }));
    }
    async function operate(action: () => Promise<unknown>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await action(); error = "";
        }
        catch (problem) {
            error = failure(problem);
        }
        finally {
            busy = false;
        }
    }
    const restrictedTrash = $derived(!!params.paperOnly || userFiltered || !!keyword.trim());
    const resultsPending = $derived(pending || queryKey !== lastQuery || keyword.trim() !== applied.trim());
    function remove(all = false): void {
        if (all && (resultsPending || !index.ids.length)) return;
        const ids = all ? [...index.ids] : [...selected], trash = params.scope === "trash";
        void operate(() => write(() => trash ? purgePages(all && !restrictedTrash ? null : ids)
            : confirmed(token => window.api.pages.trash(ids, source, token))));
    }
    function actions(row: PageSummary): ReturnType<typeof pageMenu> {
        const ids = selected.has(row.id) ? [...selected] : [row.id];
        return pageMenu(row, source, ids, true).map(item => item.id === "open" || item.id === "openSide" ? { ...item, run: () => open(ids, item.id === "openSide") } : item);
    }
    function importPDF(paths?: string[], pageId?: string): void {
        void operate(() => importPapers(pageId ? { kind: "page", id: pageId } : source, { paths, pageId, tabId }));
    }
    async function selectImported(ids: string[]): Promise<void> {
        const current = new Set(index.ids);
        if (ids.some(id => !current.has(id))) {
            const before = queryKey;
            keyword = ""; applied = "";
            if (params.scope !== "all" || userFiltered) change({ scope: "all", tags: [], filters: [], pageType: undefined });
            await tick();
            // A changed query has already requested its read. Otherwise request exactly one.
            if (queryKey === before) subscriptions?.refresh();
            await visits.settled(tabId);
        }
        if (!alive || importedPages.get(tabId) !== ids) return;
        const present = new Set(index.ids), matches = ids.filter(id => present.has(id));
        selected = new SvelteSet(matches);
        if (matches.length) grid?.scrollToRow(index.ids.indexOf(matches[0]));
        importedPages.delete(tabId);
    }
    $effect(() => {
        const ids = importedPages.get(tabId);
        if (ids) untrack(() => void selectImported(ids));
    });
</script>

<section class="library" bind:this={root}>
    <LibraryToolbar scope={params.scope} bind:keyword filtered={userFiltered}
        {busy} {pending} {restrictedTrash} empty={resultsPending || !index.ids.length} onscope={scope => change({ scope })} oncreate={() => createPage({}, query.kind === "paper" ? "paper" : "editable")}
        onimport={() => importPDF()} onempty={() => remove(true)}>
        {#snippet filters()}<LibraryFilters {params} {definitions} {change} />{/snippet}
    </LibraryToolbar>
    {#if index.ids.length || userFiltered}
        <div class="library-status">
            {#if !params.paperOnly && params.pageType}<Button variant="text" onclick={() => change({ pageType: undefined })}>{t(`library.${params.pageType.type}`)} <Icon name="close" size="var(--ui-icon-small)" /></Button>{/if}
            {#each params.tags as id (id)}<Button variant="text" onclick={() => change({ tags: params.tags.filter(tag => tag !== id) })}>{defs.get("tags")?.metadata.options?.find(o => o.id === id)?.name ?? id} <Icon name="close" size="var(--ui-icon-small)" /></Button>{/each}
            {#each params.filters as filter (filter.attribute.id)}<Button variant="text" onclick={() => change({ filters: params.filters.filter(f => f.attribute.id !== filter.attribute.id) })}>{label(filter.attribute.id)} · {valueText(filter.attribute.id, filter.value) || t("property.empty")} <Icon name="close" size="var(--ui-icon-small)" /></Button>{/each}
            <span class="total">{t("library.count", { count: index.ids.length })}</span>
        </div>
    {/if}
    {#if error}<div class="error" role="alert">{message(error)} <Button onclick={() => subscriptions?.refresh()}>{t("dialog.retry")}</Button></div>{/if}
    <div class="library-body" bind:clientWidth={bodyWidth}>
        <LibraryGrid bind:this={grid} {index} {rows} {columns} {choices} {sort} bind:selected {pending} {label} {cell}
            onsort={sortBy} oncolumns={columns => change({ columns })} onreset={() => change({ columns: undefined })}
            onrange={range} onfiles={params.scope === "trash" || busy ? undefined : importPDF} {actions} onopen={open} ondelete={() => remove()} />
        {#if params.showProperties !== false}
            <Resizer direction="vertical" label={t("library.panelWidth")} origin={bodyWidth - paneWidth} min={bodyWidth * .2} max={bodyWidth * .85}
                changeCB={width => change({ infoWidth: Math.max(1, Math.round(bodyWidth - width)) })} />
            <aside style:width={paneWidth + "px"} aria-label={t("editor.properties")}>
                {#if selected.size > 1}<div data-paragraph>{t("library.selected", { count: selected.size })}</div>
                {:else if detail && detail === single}{#key detail}<PageInformation {tabId} pageId={detail} />{/key}{/if}
            </aside>
        {/if}
    </div>
</section>

<style>
    .library { height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--ui-text); background: var(--ui-surface-window); font-family: var(--ui-font-family); }
    .library-status, .error { display: flex; align-items: center; gap: var(--ui-space-2); padding-inline: var(--ui-space-3); min-height: var(--ui-row-height); font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    .library-status { flex: none; overflow-x: auto; white-space: nowrap; }
    .library-status :global(button) { flex: none; font-size: inherit; height: var(--ui-row-height); }
    .total { margin-inline-start: auto; }
    .error { color: var(--ui-danger); }
    aside { flex: none; overflow: auto; min-width: 0; }
    aside > :where([data-paragraph]) { padding: var(--ui-space-3); color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    .library-body { flex: 1; display: flex; min-width: 0; min-height: 0; }
</style>