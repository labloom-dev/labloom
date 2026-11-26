<script module lang="ts">
    import { tabState } from "../Tab/state.svelte";
    import type { Tab } from "../Tab/defs";
    import type { TablePosition } from "./table-rows";

    type Location = { selected: ReadonlySet<string>; keyword: string; top?: TablePosition };
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
    import { builtinAttrsByPageKind, isBuiltin } from "../../../shared/attrs/builtins";
    import { defaultValue } from "../../../shared/attrs/values";
    import { isComposingKey } from "../../../shared/content/commands";
    import { isTimeType, nowSeconds, secondsPerDay, secondsToDay, secondsToMonth, secondsToYear } from "../../../shared/content/time";
    import type { AttributeDefinition, AttributeValue } from "../../../shared/types/attributes";
    import { pageKinds, type PageSummary } from "../../../shared/types/content";
    import { conditionReady, groupGranularity, type GroupValue, type ViewCondition, type ViewQuery, type ViewSort } from "../../../shared/workspace/query";
    import { allowedPageKinds, columnField, defaultColumns, fieldColumn, repairTableFields, repairTrashFields,
        tableBatchSize, type TableParams, type ViewResult } from "../../../shared/workspace/table";
    import { viewCreation } from "../../../shared/workspace/query-create";
    import { currentLanguage, failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import { registerEditing } from "../layout/commands";
    import { openPage } from "../layout/navigation";
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
    import TableGrid from "./TableGrid.svelte";
    import { importedPages, importPaperFiles } from "./library-import.svelte";
    import TableToolbar from "./TableToolbar.svelte";
    import TableFilters from "./TableFilters.svelte";
    import TableSorts from "./TableSorts.svelte";
    import TableGrouping from "./TableGrouping.svelte";
    import TableCellEditor from "./TableCellEditor.svelte";
    import { conditionLabel } from "./query-labels";
    import { tableRows, type RetainedRow, type TablePage } from "./table-rows";

    type Props = ViewProps<"library" | "papers"> | ViewProps<"trash">;
    let props: Props = $props();
    const tabId = $derived(props.tabId), preset = $derived(props.viewType);
    const trash = $derived(preset === "trash"), paper = $derived(preset === "papers");
    const session = crypto.randomUUID();
    const location = untrack(() => tabLocation(props.tabId));
    let root: HTMLElement, grid: TableGrid;
    let index = $state.raw<ViewResult>({ ids: [], titles: [] }), definitions = $state.raw<AttributeDefinition[]>([]);
    const rows = new SvelteMap<string, PageSummary>();
    let names = $state.raw<Record<string, string>>({}), selected = $state.raw<ReadonlySet<string>>(location.selected);
    let pending = $state(true), busy = $state(false), error = $state<ErrorValue>(""), keyword = $state(location.keyword), applied = $state(location.keyword);
    $effect(() => {
        location.selected = selected;
        location.keyword = keyword;
    });
    let subscriptions: ReturnType<typeof registerPageView> | undefined;
    let generation = 0, schemaDirty = true, labelRevision = 0, lastLabels = 0, alive = true, loading = new SvelteSet<string>();
    const defs = $derived(new Map(definitions.map(def => [def.id, trash && def.id === "recycled_at" ? { ...def, hidden: false } : def])));
    const choices = $derived(["title", ...(paper ? [] : ["kind"]), ...[...defs.values()].filter(def => !def.hidden).map(def => def.id)]);
    const noQuery: ViewQuery = { conditions: [], sort: [] };
    const query = $derived(props.viewType === "trash" ? noQuery : props.params.query);
    const sort = $derived(props.viewType === "trash" ? props.params.sort : query.sort);
    const zone = $derived(currentTimeZone()), language = $derived(currentLanguage());
    const title = $derived(t(trash ? "shell.trashView" : paper ? "command.papers" : "command.library"));
    const columns = $derived((props.params.columns ?? defaultColumns(preset)).filter(c => !definitions.length || choices.includes(c.id)));
    const group = $derived(query.group), canImport = $derived(!trash && (paper || allowedPageKinds(query).includes("paper")));
    let filterOpen = $state(false), focusFilter = $state<{ index: number }>();
    const criteriaKey = $derived(JSON.stringify([applied, query.conditions, sort, group?.field, group?.granularity]));
    const lookupKey = $derived(JSON.stringify([criteriaKey, zone, language]));
    const columnKey = $derived(columns.map(c => c.id).join("\n"));
    let retained = $state.raw<{ criteria: string; rows: RetainedRow[] }>({ criteria: "", rows: [] });
    const keptRows = $derived(retained.criteria === criteriaKey ? retained.rows : []);
    const unfolded: GroupValue[] = [];
    type LayoutOptions = { grouped: boolean; collapsed: GroupValue[]; retained: RetainedRow[]; result: ReturnType<typeof tableRows> };
    const layouts = new WeakMap<ViewResult, LayoutOptions>();
    function layoutFor(index: ViewResult, grouped: boolean, collapsed: GroupValue[], retained: RetainedRow[]): ReturnType<typeof tableRows> {
        const previous = layouts.get(index);
        if (previous?.grouped === grouped && previous.collapsed === collapsed && previous.retained === retained) return previous.result;
        const result = tableRows(index, grouped, collapsed, retained);
        layouts.set(index, { grouped, collapsed, retained, result });
        return result;
    }
    const layout = $derived(layoutFor(index, !!group, group?.collapsed ?? unfolded, keptRows));
    const checkRecycled = new SvelteSet<string>();
    $effect(() => {
        const key = criteriaKey;
        untrack(() => {
            if (retained.rows.length && retained.criteria !== key) {
                retained = { criteria: key, rows: [] };
                checkRecycled.clear();
            }
        });
    });
    type CellDraft = { sequence: number; entry: TablePage; column: string; original: AttributeValue; value: AttributeValue; handoffs: string[] };
    let editing = $state.raw<CellDraft>();
    let editSequence = 0;
    const creationWrites = new SvelteSet<string>();
    let pendingCreation = $state.raw<{ id: string; request: Promise<PageSummary> }>();

    let bodyWidth = $state(0), detail = $state("");
    const paneWidth = $derived(Math.min(bodyWidth * .8, props.params.infoWidth ?? bodyWidth / 3));
    const inspected = $derived(props.params.showProperties !== false && selected.size === 1 ? selected.values().next().value ?? "" : "");
    const single = $derived(inspected === pendingCreation?.id ? "" : inspected);
    $effect(() => {
        const id = single;
        detail = "";
        if (!id) return;
        const timer = setTimeout(() => detail = id, 80);
        return () => clearTimeout(timer);
    });
    let lastLookup = $state(""), lastCriteria = "", lastColumns = "";
    $effect(() => {
        const target = keyword;
        const timer = setTimeout(() => applied = target, 200);
        return () => clearTimeout(timer);
    });
    function changeLayout(patch: Pick<Partial<TableParams>, "columns" | "infoWidth">): void {
        if (props.viewType === "trash") props.onparams({ ...props.params, ...patch });
        else props.onparams({ ...props.params, ...patch });
    }
    function changeQuery(next: ViewQuery): void {
        if (props.viewType !== "trash") props.onparams({ ...props.params, query: next });
    }
    function changeConditions(conditions: ViewCondition[]): void {
        changeQuery({ ...query, conditions });
    }
    function changeSort(next: ViewSort[]): void {
        if (props.viewType === "trash") props.onparams({ ...props.params, sort: next });
        else changeQuery({ ...query, sort: next });
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
        return def ? libraryText(def, value, language, zone, t, names) : "";
    }
    function cell(page: PageSummary, id: string): string {
        if (id === "title") return page.title || t("shell.untitled");
        if (id === "kind") return t(`library.${page.kind}`);
        return valueText(id, page.attributes[id]);
    }
    function groupLabel(value: GroupValue): string {
        if (!group) return "";
        const id = fieldColumn(group.field), def = defs.get(id);
        if (value === null) return t("table.noGroupValue", { name: label(id) });
        if (group.field.kind === "page-type") {
            const kind = pageKinds.find(kind => kind === value);
            return kind ? t(`library.${kind}`) : "";
        }
        if (def && typeof value === "number" && isTimeType(def.type)) {
            const granularity = groupGranularity(def.type, group.granularity);
            if (granularity === "year") return secondsToYear(value);
            if (granularity === "month") return secondsToMonth(value);
            if (granularity === "week") return secondsToDay(value) + " – " + secondsToDay(value + 6 * secondsPerDay);
            return secondsToDay(value);
        }
        return valueText(id, def?.type === "multiselect" || def?.type === "page-links" ? [value] : value) || String(value);
    }
    function sortBy(id: string, extend: boolean): void {
        const ordered = sort.findIndex(item => fieldColumn(item.field) === id);
        const type = defs.get(id)?.type, current = sort[ordered];
        const desc = current ? current.direction === (extend || sort.length === 1 ? "asc" : "desc") : !!type && isTimeType(type);
        const level: ViewSort = { field: columnField(id), direction: desc ? "desc" : "asc" };
        changeSort(!extend ? [level] : ordered < 0 ? [...sort, level] : sort.map((item, i) => i === ordered ? level : item));
    }
    function toggleGroup(value: GroupValue, collapsed: boolean): void {
        if (!group || group.collapsed.includes(value) === collapsed) return;
        const next = collapsed ? [...group.collapsed, value] : group.collapsed.filter(item => item !== value);
        changeQuery({ ...query, group: { ...group, collapsed: next } });
    }
    async function fetchRows(ids: string[], version: number, refresh?: ReadonlySet<string>): Promise<Set<string> | undefined> {
        const batch = loading, needed = [...new Set(ids)].filter(id => !batch.has(id) && (!rows.has(id) || refresh?.has(id)));
        if (!needed.length) return;
        needed.forEach(id => batch.add(id));
        try {
            const updates = await window.api.pages.listUpdates({ ids: needed, limit: needed.length, deleted: trash }, [], columns.map(c => c.id));
            if (!alive || generation !== version) return;
            if (updates.names) names = { ...names, ...updates.names };
            for (const page of updates.items) rows.set(page.id, page);
            return new Set(updates.items.map(page => page.id));
        }
        finally {
            needed.forEach(id => batch.delete(id));
        }
    }
    const rowIds = (value: typeof layout, from: number, to: number): string[] =>
        value.items.slice(from, to).flatMap(item => item.kind === "page" ? [item.id] : []);
    function range(first: number, end: number): void {
        if (editing) {
            const position = layout.positions.get(editing.entry.key);
            if (position === undefined || position < first || position >= end) void finishEdit(true);
        }
        const version = generation;
        const from = Math.floor(first / tableBatchSize) * tableBatchSize, to = Math.ceil((end + 12) / tableBatchSize) * tableBatchSize;
        void fetchRows(rowIds(layout, from, to), version).catch(problem => {
            if (alive && generation === version) error = failure(problem);
        });
    }
    function repair(): boolean {
        if (props.viewType === "trash") {
            const current = props.params, repaired = repairTrashFields(current, defs);
            if (repaired === current) return false;
            props.onparams(repaired);
        }
        else {
            const current = props.params, repaired = repairTableFields(current, defs, props.viewType);
            if (repaired === current) return false;
            props.onparams(repaired);
        }
        return true;
    }
    async function load(ids: string[]): Promise<void> {
        const key = lookupKey, criteria = criteriaKey, version = ++generation, schema = schemaDirty, labels = labelRevision;
        const reset = criteria !== lastCriteria;
        let at = !lastLookup ? location.top : reset ? undefined : grid?.position();
        loading = new SvelteSet();
        pending = true;
        try {
            if (schema) {
                schemaDirty = false;
                try {
                    const next = await window.api.attributes.definitions();
                    if (!alive) return;
                    definitions = next;
                }
                catch (problem) {
                    schemaDirty = true;
                    throw problem;
                }
            }
            if (repair()) {
                await tick();
                subscriptions?.refresh();
                return;
            }

            const refreshAll = columnKey !== lastColumns || schema || labels !== lastLabels, changed = new SvelteSet(ids);
            const fields = columns.map(c => c.id), requested = !at?.index ? fields : undefined;
            const known = requested && key === lastLookup && !refreshAll && ids.length
                ? [...new Set(rowIds(layout, 0, tableBatchSize + 12))].filter(id => !changed.has(id) && rows.has(id)) : undefined;
            const type = props.viewType;
            const { initial, ...next } = type === "trash" ? await window.api.pages.trashIndex(copyData({ sort, keyword: applied, language, session, known }), requested)
                : await window.api.pages.viewIndex(copyData({ type, query, keyword: applied, language, session, known }), requested);
            if (!alive || key !== lookupKey) return;
            if (!reset && grid) at = grid.position();
            if (next.names) names = { ...names, ...next.names };
            for (const page of initial ?? []) {
                rows.set(page.id, page);
                changed.delete(page.id);
            }
            const checking = keptRows.filter(row => checkRecycled.has(row.id)).map(row => row.id);
            if (checking.length) {
                const present = await fetchRows(checking, version, new Set(checking));
                if (!alive || key !== lookupKey) return;
                const missing = new Set(checking.filter(id => present && !present.has(id)));
                checking.forEach(id => checkRecycled.delete(id));
                if (missing.size) retained = { ...retained, rows: retained.rows.filter(row => !missing.has(row.id)) };
            }
            const nextLayout = layoutFor(next, !!group, group?.collapsed ?? unfolded, keptRows);
            const anchor = (at?.key ? nextLayout.positions.get(at.key) : undefined) ?? (at?.id ? nextLayout.firstOccurrences.get(at.id) : undefined);
            const first = anchor ?? Math.max(0, Math.min(at?.index ?? 0, nextLayout.items.length - 1));
            const viewport = new SvelteSet(rowIds(nextLayout, Math.max(0, first - 12), first + (grid?.viewportSize() || tableBatchSize)));
            const prefetched = new Set(initial?.map(page => page.id));
            for (const id of rows.keys()) {
                if (!nextLayout.ids.has(id) || !viewport.has(id) && !prefetched.has(id) && (refreshAll || changed.has(id))) rows.delete(id);
            }
            if (initial) for (const page of initial) viewport.delete(page.id);
            await fetchRows([...viewport], version, refreshAll ? viewport : changed);
            if (!alive || key !== lookupKey) return;
            index = next;
            if ([...selected].some(id => !nextLayout.ids.has(id))) selected = new SvelteSet([...selected].filter(id => nextLayout.ids.has(id)));
            lastCriteria = criteria; lastLookup = key; lastColumns = fields.join("\n"); lastLabels = labels;
            await tick();
            if (grid && (reset || at && grid.position().key !== at.key)) grid.restorePosition(first, at?.offset);
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
    function refreshVisibleSplit(): void {
        const group = tabState.groups.find(group => group.activeTabId === tabId);
        if (group && group.id !== tabState.focusedGroupId) {
            queueMicrotask(() => {
                if (alive && group.activeTabId === tabId) void visits.settled(tabId);
            });
        }
    }
    onMount(() => {
        const offEditing = registerEditing(root, command => {
            if (command === "selectAll") grid.selectAll();
        });
        const flush = (): void => {
            if (editing) void finishEdit(true);
        };
        window.addEventListener("workspace-flush", flush);
        subscriptions = registerPageView(tabId, {
            changed(event) {
                schemaDirty ||= !!event.definition;
                if ([...(event.titlePages ?? []), ...(event.purged ?? [])].some(id => Object.hasOwn(names, id))) labelRevision++;
                if (event.purged?.some(id => Object.hasOwn(names, id))) {
                    const next = { ...names };
                    for (const id of event.purged) delete next[id];
                    names = next;
                }
                for (const id of [...(event.recycledPages ?? []), ...(event.purged ?? [])]) {
                    if (retained.rows.some(row => row.id === id)) checkRecycled.add(id);
                }
                const changed = event.summaryPages ?? event.pages;
                if (event.writeId && creationWrites.delete(event.writeId) && changed.length === 1 && !event.definition &&
                    !event.purged?.length && (event.recycledPages ?? []).every(id => id === changed[0])) {
                    return [];
                }
                refreshVisibleSplit();
                return [...changed, ...(event.purged ?? []), ...(event.definition ? [event.definition] : [])];
            }, read: load, pending: () => !!editing, flush: () => finishEdit(true)
        });
        return () => {
            if (layout.ids.size) location.top = grid?.position() ?? location.top;
            window.removeEventListener("workspace-flush", flush);
            alive = false; subscriptions?.(); offEditing();
            void window.api.pages.releaseView(session).catch(() => {});
        };
    });
    $effect(() => {
        void lookupKey; void columnKey;
        untrack(() => {
            subscriptions?.refresh();
            refreshVisibleSplit();
        });
    });
    function open(ids: string[], side: boolean): void {
        ids.forEach((id, i) => {
            const show = (): void => openPage(id, { currentGroup: true, otherGroup: side && i === 0 });
            if (pendingCreation?.id === id) void pendingCreation.request.then(show, () => {});
            else show();
        });
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
    const resultsPending = $derived(pending || lookupKey !== lastLookup || keyword.trim() !== applied.trim());
    function remove(all = false): void {
        if (all && (resultsPending || !layout.ids.size && !applied.trim())) return;
        const ids = [...selected];
        void operate(() => write(() => trash ? purgePages(all ? null : ids)
            : confirmed(token => window.api.pages.trash(ids, props.source, token))));
    }
    function actions(row: PageSummary): ReturnType<typeof pageMenu> {
        const ids = selected.has(row.id) ? [...selected] : [row.id];
        return pageMenu(row, props.source, ids, true).map(item => item.id === "open" || item.id === "openSide" ? { ...item, run: () => open(ids, item.id === "openSide") } : item);
    }
    function groupForNew(value?: GroupValue): GroupValue | undefined {
        if (!group) return undefined;
        if (value !== undefined) return value;
        const selectedGroup = grid?.selectedGroup(), first = layout.groups.values().next().value;
        return selectedGroup !== undefined ? selectedGroup : first ? first.value : index.groups?.[0]?.value ?? null;
    }
    function retainPages(pages: PageSummary[], criteria: string, value?: GroupValue): boolean {
        if (!alive || criteria !== criteriaKey || !pages.length) return false;
        const valid = pages.filter(page => !page.attributes.deleted);
        if (!valid.length) return false;
        for (const page of valid) rows.set(page.id, page);
        retained = { criteria, rows: [...valid.map(({ id, title }) => ({ id, title, group: value })), ...keptRows] };
        if (value !== undefined) toggleGroup(value, false);
        return true;
    }
    function newRow(): void {
        if (trash) return;
        const criteria = criteriaKey, value = groupForNew();
        const { kind, initial } = viewCreation(query, defs, zone, nowSeconds(), value, paper ? "paper" : undefined);
        void operate(async () => {
            const id = crypto.randomUUID(), writeId = crypto.randomUUID();
            creationWrites.add(writeId);
            const request = write(() => window.api.pages.create(props.source, "", copyData(initial), undefined, kind, { id, writeId }));
            pendingCreation = { id, request };
            try {
                // Mount the title field while the page and its initial attributes are saved.
                if (retainPages([{ id, kind, title: "", excerpt: "", attributes: initial }], criteria, value)) {
                    await tick();
                    const entry = grid?.focusPage(id);
                    if (entry) beginEdit(entry, "title");
                }
                const page = await request;
                if (alive && layout.ids.has(page.id)) rows.set(page.id, page);
            }
            catch (problem) {
                creationWrites.delete(writeId);
                if (editing?.entry.id === id) void finishEdit(false, true);
                retained = { ...retained, rows: retained.rows.filter(row => row.id !== id) };
                rows.delete(id);
                if (selected.has(id)) selected = new SvelteSet([...selected].filter(page => page !== id));
                throw problem;
            }
            finally {
                pendingCreation = undefined;
            }
        });
    }
    async function placeImported(ids: string[], criteria: string, value?: GroupValue): Promise<void> {
        if (!ids.length || !alive || criteria !== criteriaKey) return;
        const { items, names: references } = await window.api.pages.listUpdates({ ids, limit: ids.length }, [], columns.map(c => c.id));
        const byId = new Map(items.map(item => [item.id, item]));
        const ordered = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
        if (!retainPages(ordered, criteria, value)) return;
        if (references) names = { ...names, ...references };
        await tick();
        grid?.focusPage(ordered[0].id);
        selected = new SvelteSet(ordered.map(item => item.id));
    }
    function importPDF(paths?: string[], pageId?: string, fromDrop?: GroupValue): void {
        const criteria = criteriaKey, value = groupForNew(fromDrop);
        const { initial } = viewCreation(query, defs, zone, nowSeconds(), value, "paper");
        void operate(async () => {
            const { pages } = await importPaperFiles(pageId ? { kind: "page", id: pageId } : props.source,
                { paths, pageId, initial: pageId ? undefined : copyData(initial) });
            if (!pageId) await placeImported(pages, criteria, value);
        });
    }
    $effect(() => {
        const ids = importedPages.get(tabId);
        if (ids) untrack(() => {
            importedPages.delete(tabId);
            void operate(() => placeImported(ids, criteriaKey, groupForNew()));
        });
    });
    function editable(page: PageSummary, id: string): boolean {
        const def = defs.get(id);
        return !trash && !page.attributes.deleted && (id === "title" || !!def && !def.readonly && id !== "deleted" &&
            (!isBuiltin(id) || (builtinAttrsByPageKind[page.kind] as readonly string[]).includes(id)));
    }
    function beginEdit(entry: TablePage, column: string): void {
        const page = rows.get(entry.id);
        if (!page || !editable(page, column) || editing?.entry.key === entry.key && editing.column === column) return;
        if (editing) void finishEdit(true);
        const value = column === "title" ? page.title : page.attributes[column] ?? defaultValue(defs.get(column)!.type);
        editing = { sequence: ++editSequence, entry, column, value, original: value, handoffs: [] };
    }
    function editValue(value: AttributeValue): void {
        if (editing) editing = { ...editing, value };
    }
    function stageFiles(sequence: number, ids: string[]): boolean {
        if (!editing || editing.sequence !== sequence || !ids.length) return false;
        const def = defs.get(editing.column);
        if (!def || def.type !== "file" && def.type !== "files") return false;
        const value = def.type === "file" ? ids[0] : [...new Set([...(Array.isArray(editing.value) ? editing.value : []), ...ids])];
        editing = { ...editing, value, handoffs: [...editing.handoffs, ...ids] };
        return true;
    }
    async function finishEdit(save: boolean, focus = false, step?: number): Promise<boolean> {
        const edit = editing;
        if (!edit) return true;
        editing = undefined;
        if (focus) grid?.focusGrid();
        const { column, value, entry, handoffs } = edit;
        let saved = true;
        try {
            if (save && JSON.stringify(edit.original) !== JSON.stringify(value)) {
                const source = props.source;
                saved = await write(() => confirmed(token => column === "title" ? window.api.pages.rename(entry.id, String(value), source, token)
                    : window.api.pages.commitEdit({ pageId: entry.id, batch: 0, blocks: [], attributes: { [column]: copyData(value) } }, source, token)));
            }
        }
        catch (problem) {
            error = failure(problem);
            saved = false;
        }
        finally {
            if (handoffs.length) {
                try {
                    await window.api.attachments.releaseHandoffs(handoffs);
                }
                catch (problem) {
                    error = failure(problem); saved = false;
                }
            }
        }
        if (saved && step && await visits.settled(tabId) && alive && !editing) {
            const page = rows.get(entry.id);
            if (page) {
                const editableColumns = columns.filter(item => editable(page, item.id));
                const next = editableColumns[editableColumns.findIndex(item => item.id === column) + step];
                const row = next && grid?.focusPage(entry.id);
                if (row) beginEdit(row, next.id);
            }
        }
        return saved;
    }
    function guardButton(event: KeyboardEvent): void {
        if (isComposingKey(event) && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    }
</script>

<section class="library" data-table-view={preset} bind:this={root}>
    <TableToolbar query={trash ? undefined : query} {sort} bind:keyword bind:filterOpen={() => filterOpen, open => {
        filterOpen = open;
        if (!open) focusFilter = undefined;
    }} {busy} pending={resultsPending} empty={resultsPending || !layout.ids.size && !applied.trim()}
        oncreate={trash ? undefined : newRow}
        onimport={canImport ? () => importPDF() : undefined} onempty={trash ? () => remove(true) : undefined}>
        {#snippet filters()}
            <TableFilters conditions={query.conditions} {choices} definitions={defs} {label} {names} {zone} focus={focusFilter} onchange={changeConditions} />
        {/snippet}
        {#snippet sorts()}<TableSorts {sort} {choices} {label} onchange={changeSort} />{/snippet}
        {#snippet groups()}
            <TableGrouping {group} {choices} definitions={defs} {label} onchange={group => changeQuery({ ...query, group })} />
        {/snippet}
    </TableToolbar>
    {#if query.conditions.length || layout.ids.size}
        <div class="condition-strip">
            {#each query.conditions as condition, i (i)}
                {@const text = conditionLabel(condition, defs, label, zone, names)}
                <span class:incomplete={!conditionReady(condition)} data-table-filter-chip>
                    <Button variant="text" onkeydown={guardButton} onclick={() => {
                        focusFilter = { index: i }; filterOpen = true;
                    }}>{text}</Button>
                    <IconButton icon="close" label={t("table.removeCondition")} onkeydown={guardButton} onclick={() => changeConditions(query.conditions.filter((_, index) => i !== index))} />
                </span>
            {/each}
            {#if layout.ids.size}<span class="total">{t("library.count", { count: layout.ids.size })}</span>{/if}
        </div>
    {/if}
    {#if error}<div class="error" role="alert">{message(error)} <Button onclick={() => subscriptions?.refresh()}>{t("dialog.retry")}</Button></div>{/if}
    <div class="library-body" bind:clientWidth={bodyWidth}>
        <TableGrid bind:this={grid} {layout} {rows} {columns} {choices} {sort} bind:selected pending={resultsPending} {label} {cell} {title} {groupLabel}
            onsort={sortBy} oncolumns={columns => changeLayout({ columns })} onreset={() => changeLayout({ columns: defaultColumns(preset) })}
            onrange={range} ongroup={toggleGroup} onfiles={canImport && !busy ? importPDF : undefined} {actions} onopen={open} ondelete={() => remove()}
            onedit={trash ? undefined : beginEdit}>
            {#snippet editor(entry, id, _page, contents)}
                {#if editing?.entry.key === entry.key && editing.column === id}
                    {@const sequence = editing.sequence}
                    <TableCellEditor label={label(id)} definition={id === "title" ? undefined : defs.get(id)} value={editing.value} {contents}
                        onchange={editValue} onstage={ids => stageFiles(sequence, ids)} onfinish={(save, focus, step) => void finishEdit(save, focus, step)} />
                {:else}{@render contents()}{/if}
            {/snippet}
        </TableGrid>
        {#if props.params.showProperties !== false}
            <Resizer direction="vertical" label={t("library.panelWidth")} origin={bodyWidth - paneWidth} min={bodyWidth * .2} max={bodyWidth * .85}
                changeCB={width => changeLayout({ infoWidth: Math.max(1, Math.round(bodyWidth - width)) })} />
            <aside style:width={paneWidth + "px"} aria-label={t("editor.properties")}>
                {#if selected.size > 1}<div data-paragraph>{t("library.selected", { count: selected.size })}</div>
                {:else if detail && detail === single}{#key detail}<PageInformation {tabId} pageId={detail} readonly={trash} />{/key}{/if}
            </aside>
        {/if}
    </div>
</section>

<style>
    .library { height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--ui-text); background: var(--ui-surface-window); font-family: var(--ui-font-family); }
    .error { display: flex; align-items: center; gap: var(--ui-space-2); padding-inline: var(--ui-space-3); min-height: var(--ui-row-height); font-size: var(--ui-font-small); color: var(--ui-danger); }
    aside { flex: none; overflow: auto; min-width: 0; }
    aside > :where([data-paragraph]) { padding: var(--ui-space-3); color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    .library-body { flex: 1; display: flex; min-width: 0; min-height: 0; }
    .condition-strip { display: flex; flex: none; align-items: center; gap: var(--ui-space-2); overflow-x: auto; padding: var(--ui-space-1) var(--ui-space-2); }
    .condition-strip > span { display: flex; flex: none; align-items: center; background: var(--ui-selected-inactive); border-radius: var(--ui-radius-control); }
    .condition-strip > span.incomplete { background: var(--ui-surface-panel); color: var(--ui-text-secondary); }
    .condition-strip > span.incomplete :global(button) { color: inherit; }
    .condition-strip > .total { margin-inline-start: auto; background: none; color: var(--ui-text-secondary); font-size: var(--ui-font-small); white-space: nowrap; }
    .condition-strip :global(button) { white-space: nowrap; height: var(--ui-row-height); font-size: var(--ui-font-small); }
</style>