<script lang="ts">
    import { onMount, tick, untrack, type Snippet } from "svelte";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import type { FeedAPI } from "../../../shared/feed/ipc";
    import { workspaceHistory } from "../../../shared/history/ipc";
    import type { KnowledgeChange } from "../../../shared/types/content";
    import { feedBatchSize, type FeedItem, type FeedItemDetail, type FeedPaperState, type FeedQuery, type FeedSource, type FeedSourceAction, type FeedSourceInput } from "../../../shared/types/feed";
    import type { FeedParams, FeedScope } from "../../../shared/workspace/feed";
    import { failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import ConfirmDialog from "../base/ConfirmDialog.svelte";
    import Dialog from "../base/Dialog.svelte";
    import Menu, { type MenuItem } from "../base/Menu.svelte";
    import type { SelectOption } from "../base/Select.svelte";
    import VirtualList from "../base/VirtualList.svelte";
    import { WindowRows } from "../base/window-rows";
    import { pageMenu } from "../Knowledge/page-menu";
    import { write } from "../Knowledge/page-sessions";
    import type { ViewProps } from "../Tab/views";
    import { openPage } from "../layout/navigation";
    import FeedLayout from "./FeedLayout.svelte";
    import FeedReader from "./FeedReader.svelte";
    import FeedRow from "./FeedRow.svelte";
    import FeedSources from "./FeedSources.svelte";
    import FeedStatus from "./FeedStatus.svelte";
    import FeedToolbar from "./FeedToolbar.svelte";
    import { registerViewMenu } from "../Tab/view-menu";
    import { feedRequests } from "./navigation";
    import { downloadAttachment, saveSubscription } from "./operations";
    import { sourceMenu } from "./source-menu";
    import SourceForm from "./SourceForm.svelte";

    let { tabId, params: tabParams, onparams, source: history = workspaceHistory, api = window.api.feed, sourcePageId, sourceTitle, belowTitle,
        attachPDF = (pageId, fileId) => window.api.papers.attachFile(pageId, "paper_files", fileId, workspaceHistory),
        openPaper = window.api ? openPage : undefined }: Partial<ViewProps<"feed">> & {
        sourcePageId?: string; sourceTitle?: string; belowTitle?: Snippet; api?: FeedAPI;
        attachPDF?: (pageId: string, fileId: string) => Promise<void>; openPaper?: (id: string) => void;
    } = $props();

    let localParams = $state<FeedParams>({});
    const params = $derived(sourcePageId ? localParams : tabParams ?? localParams);
    const scope: FeedScope = $derived(sourcePageId ?? params.scope ?? "all");
    const read = $derived(params.read ?? "all"), order = $derived(params.order ?? "newest"), followed = $derived(scope === "followed");
    let keyword = $state(""), applied = $state("");
    const query = $derived<FeedQuery>({ sourceId: scope === "all" || followed ? undefined : scope, followed, keyword: applied.trim(), read, order });
    const queryKey = $derived(JSON.stringify(query));
    function change(patch: FeedParams): void {
        if (onparams && !sourcePageId) onparams({ ...params, ...patch });
        else localParams = { ...params, ...patch };
    }
    $effect(() => {
        const text = keyword;
        const wait = setTimeout(() => applied = text, 300);
        return () => clearTimeout(wait);
    });

    let loaded = $state(false), pending = $state(true), refreshRequests = $state(0);
    let error = $state<ErrorValue>("");
    let retry = $state.raw<(() => void) | undefined>();
    let ids = $state.raw<string[]>([]), sources = $state.raw<FeedSource[]>([]), keywords = $state.raw<string[]>([]), unread = $state(0);
    let itemList: VirtualList, articleReader: FeedReader;
    let detail = $state.raw<FeedItemDetail>(), selected = $state(""), reading = $state(false);
    let want = "";
    const paperStates = new SvelteMap<string, FeedPaperState>();
    const rowCache = new WindowRows<FeedItem>(async ids => (await api.getRows(ids)).map(withPaperState), cause => fail(cause, () => void reload()));
    const activeSources = $derived(sources.filter(row => row.status !== "cancelled"));
    const cancelledSources = $derived(sources.filter(row => row.status === "cancelled"));
    const source = $derived(sources.find(row => row.id === scope));
    const refreshing = $derived(refreshRequests > 0 || sources.some(row => row.refreshing));
    const canRefresh = $derived(sources.some(row => row.status === "enabled"));
    const articleIndex = $derived(detail ? ids.indexOf(detail.id) : -1);
    const choices = $derived<SelectOption[]>(sources.length ? [
        { value: "all", label: t("feed.all") + " · " + unread },
        { value: "followed", label: t("feed.followed") },
        ...activeSources.map(sourceOption)
    ] : []);
    const cancelledChoices = $derived(cancelledSources.map(sourceOption));

    let alive = true, loads = 0, opening = 0, previousQuery = "", kept = "", pinnedQuery = "";
    let reloadTimer: ReturnType<typeof setTimeout> | undefined, openTimer: ReturnType<typeof setTimeout> | undefined;
    let formOpen = $state(false), editing = $state.raw<FeedSource>(), saving = $state(false), formError = $state<ErrorValue>("");
    let formOpener: HTMLElement | undefined;
    let importing = $state(false);
    const downloads = new SvelteSet<string>();

    type Decision = { title: string; body: string; confirmLabel: string; cancelLabel: string; danger?: boolean; run: () => void };
    let confirmation = $state.raw<Decision>();

    function sourceOption(row: FeedSource): SelectOption {
        return {
            value: row.id, label: (row.name || t("shell.untitled")) + " · " + row.unreadCount,
            icon: row.refreshing ? "loading" : row.status === "paused" ? "debug-pause" : row.error ? "warning" : undefined
        };
    }
    function fail(cause: unknown, again?: () => void): void {
        if (!alive) return;
        error = failure(cause); retry = again;
    }
    function withPaperState<T extends FeedItem>(item: T): T {
        const state = item.paperId && paperStates.get(item.paperId);
        return state && state !== item.paperState ? { ...item, paperState: state } : item;
    }
    function updateLinkedPapers(change: KnowledgeChange): void {
        if (change.paperStates || change.purged?.length) {
            for (const [id, state] of Object.entries(change.paperStates ?? {})) paperStates.set(id, state);
            for (const id of change.purged ?? []) paperStates.set(id, "missing");
            for (const row of rowCache.rows.values()) {
                const next = withPaperState(row);
                if (next !== row) rowCache.rows.set(row.id, next);
            }
            if (detail) detail = withPaperState(detail);
        }
        // File changes can affect the PDF actions for the open article.
        if (detail?.paperId && detail.paperState === "saved" && change.pages.includes(detail.paperId)) void syncDetail(detail.id);
    }
    function range(first: number, end: number): void {
        const from = Math.max(0, Math.floor(first / feedBatchSize) * feedBatchSize);
        const to = Math.min(ids.length, Math.ceil((end + 12) / feedBatchSize) * feedBatchSize);
        void rowCache.request(ids.slice(from, to));
    }
    function forgetItem(): void {
        articleReader?.savePosition();
        clearTimeout(openTimer);
        opening++;
        detail = undefined; selected = ""; reading = false; kept = "";
    }
    async function reload(background = false): Promise<void> {
        const key = queryKey, version = ++loads, reset = key !== previousQuery, filter = query;
        pending = reset || !loaded;
        try {
            const around = reset ? undefined : itemList?.position().id;
            const pin = pinnedQuery === key ? kept : "";
            let next = await api.getState({ ...filter, keep: pin || undefined }, around);
            if (!alive || version !== loads || key !== queryKey) return;
            if (pin && filter.followed && JSON.stringify(keywords) !== JSON.stringify(next.keywords)) {
                kept = "";
                next = await api.getState(filter, around);
                if (!alive || version !== loads || key !== queryKey) return;
            }
            sources = next.sources; keywords = next.keywords; unread = next.unreadCount;
            if (!sourcePageId && filter.sourceId && !next.sources.some(row => row.id === filter.sourceId)) {
                change({ scope: "all" });
                return;
            }
            const at = !reset ? itemList?.position() : undefined;
            rowCache.start(next.items.map(withPaperState), reset);
            ids = next.ids;
            if (selected && !ids.includes(selected)) forgetItem();
            if (reset) kept = "";
            previousQuery = key; loaded = true;
            if (retry) {
                error = ""; retry = undefined;
            }
            await tick();
            if (!alive || version !== loads || key !== queryKey) return;
            if (reset) itemList?.scrollToRow(0);
            else itemList?.restorePosition(at);
            if (want) {
                const item = want;
                want = "";
                if (ids.includes(item)) choose(item);
                else fail({ kind: "feed-item-missing" });
            }
            else if (background && detail?.id === selected) void syncDetail(detail.id);
        }
        catch (cause) {
            if (version === loads && key === queryKey) fail(cause, () => void reload());
        }
        finally {
            if (alive && version === loads && key === queryKey) pending = false;
        }
    }
    function queueReload(): void {
        if (!alive) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => void reload(true), 110);
    }
    $effect(() => {
        void queryKey;
        untrack(() => void reload());
    });

    function choose(id: string, delayed = false, holding = false): void {
        clearTimeout(openTimer);
        const request = ++opening, key = queryKey;
        selected = id;
        if (!delayed) {
            itemList?.reveal(id);
            void openItem(id, request, key);
        }
        else if (!holding) openTimer = setTimeout(() => void openItem(id, request, key), 150);
    }
    async function openItem(id: string, request: number, key: string): Promise<void> {
        if (!id || !alive || request !== opening || key !== queryKey || !ids.includes(id)) return;
        try {
            const next = await api.getItem(id);
            if (!alive || request !== opening || key !== queryKey || !ids.includes(id)) return;
            const old = kept;
            if (detail?.id !== id) articleReader?.savePosition();
            kept = id; pinnedQuery = key;
            reading = true; detail = withPaperState(next);
            if (!next.isRead) await setRead(id, true);
            else if (old && old !== id && (query.read !== "all" || query.keyword || query.followed)) queueReload();
        }
        catch (cause) {
            if (request === opening) fail(cause, () => choose(id));
        }
    }
    async function syncDetail(id: string): Promise<void> {
        try {
            const next = await api.getItem(id);
            if (alive && detail?.id === id) detail = withPaperState(next);
        }
        catch (cause) {
            if (alive && detail?.id === id) fail(cause, () => void reload(true));
        }
    }
    function back(): void {
        articleReader?.savePosition();
        reading = false;
        void tick().then(() => {
            itemList?.reveal(selected);
            itemList?.focus();
        });
    }

    async function operate(action: () => Promise<unknown>): Promise<boolean> {
        try {
            await action();
            return true;
        }
        catch (cause) {
            fail(cause);
            return false;
        }
    }
    function refresh(id?: string): void {
        refreshRequests++;
        void operate(() => api.refresh(id)).finally(() => {
            refreshRequests--;
            queueReload();
        });
    }
    function openForm(target?: FeedSource, opener?: HTMLElement): void {
        if (formOpen) return;
        formOpener = opener;
        editing = target; formError = ""; formOpen = true;
    }
    function activeTab(): HTMLElement | null {
        return tabId ? document.querySelector(`[data-tabs-content][data-value="${CSS.escape(tabId)}"]`) : document.querySelector(".feed-view");
    }
    function restoreFormFocus(): HTMLElement | null | undefined {
        return formOpener?.isConnected ? formOpener : activeTab()?.querySelector("[data-feed-add]");
    }
    async function saveSource(input: FeedSourceInput): Promise<void> {
        saving = true; formError = "";
        try {
            const id = await saveSubscription(api, input, write);
            if (!id) return;
            formOpen = false;
            if (!sourcePageId) {
                if (!input.id) keyword = applied = "";
                change({ scope: id, ...(input.id ? {} : { read: "all" }) });
            }
            queueReload();
        }
        catch (cause) {
            formError = failure(cause);
        }
        finally {
            saving = false;
        }
    }
    function setSourceStatus(row: FeedSource, action: FeedSourceAction): void {
        const apply = (): void => {
            void operate(async () => {
                await write(() => api.setSourceStatus(row.id, action));
                queueReload();
                if (action === "resume") refresh(row.id);
            });
        };
        if (action !== "cancel") apply();
        else confirmation = { title: t("dialog.confirmCancelFeed"), body: t("dialog.cancelFeed"), confirmLabel: t("dialog.confirmCancelFeed"),
            cancelLabel: t("dialog.keepFeed"), danger: true, run: apply };
    }
    function markAll(row?: FeedSource): void {
        confirmation = { title: t("feed.markAllRead"), body: t("dialog.markRead", { source: row?.name || t("dialog.allSources"), count: row?.unreadCount ?? unread }),
            confirmLabel: t("dialog.confirmMarkRead"), cancelLabel: t("dialog.cancel"), run: () => void operate(async () => {
                await write(() => api.markAllRead(row?.id));
                queueReload();
            }) };
    }
    function sourceActions(target: FeedScope, opener?: HTMLElement): MenuItem[] {
        return sourceMenu(target, sources.find(row => row.id === target), refreshing, canRefresh, unread, { refresh, edit: row => openForm(row, opener), status: setSourceStatus, markAll });
    }
    async function saveKeywords(words: string[]): Promise<boolean> {
        return operate(async () => {
            keywords = await write(() => api.setKeywords(words));
            kept = "";
            queueReload();
        });
    }

    async function setRead(id: string, value: boolean): Promise<void> {
        await operate(async () => {
            await write(() => api.setRead(id, value));
            if (!alive) return;
            const row = rowCache.rows.get(id);
            if (row) rowCache.update([{ ...row, isRead: value }]);
            if (detail?.id === id) detail = { ...detail, isRead: value };
            queueReload();
        });
    }
    async function importItem(id: string, replace = false): Promise<void> {
        if (importing) return;
        importing = true;
        try {
            await operate(async () => {
                const result = await write(() => api.importItem(id, replace));
                if (result.downloadPDF) void fetchPDF(id);
                queueReload();
            });
        }
        finally {
            importing = false;
        }
    }
    async function fetchPDF(id: string): Promise<void> {
        if (downloads.has(id)) return;
        downloads.add(id);
        try {
            await downloadAttachment(api, id, attachPDF, write);
        }
        catch (cause) {
            if (detail?.id !== id) fail(cause);
            else {
                await syncDetail(id);
                if (detail?.id === id && detail.pdfStatus !== "failed") fail(cause);
            }
        }
        finally {
            downloads.delete(id);
            queueReload();
        }
    }
    function openOriginal(id: string): void {
        void operate(() => api.openItem(id));
    }

    let menu = $state(false), menuId = $state(""), point = $state({ x: 0, y: 0 });
    const menuAnchor = { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) };
    const entries = $derived(menu ? itemActions(rowCache.rows.get(menuId)) : []);
    function context(id: string, x: number, y: number): void {
        if (!rowCache.rows.has(id)) return;
        menuId = id; point = { x, y }; menu = true;
    }
    function itemActions(row?: FeedItem): MenuItem[] {
        if (!row) return [];
        return [
            { label: t(row.isRead ? "feed.markUnread" : "feed.markRead"), icon: "check", onselect: () => void setRead(row.id, !row.isRead) },
            { label: t("feed.openOriginal"), icon: "link-external", disabled: !row.url, onselect: () => openOriginal(row.id) },
            { label: t("feed.copyLink"), icon: "copy", disabled: !row.url, onselect: () => {
                if (row.url) void operate(() => navigator.clipboard.writeText(row.url!));
            } },
            row.paperState === "saved" && row.paperId
                ? { label: t("feed.openPaper"), icon: "book", disabled: !openPaper, onselect: () => openPaper?.(row.paperId!) }
                : { label: t("feed.importPaper"), icon: "add", disabled: importing, onselect: () => {
                    if (row.paperState === "none") void importItem(row.id);
                    else {
                        confirmation = { title: t("dialog.reimport"), body: t(row.paperState === "recycled" ? "dialog.reimportRecycled" : "dialog.reimportMissing"),
                            confirmLabel: t("dialog.reimport"), cancelLabel: t("dialog.cancel"), run: () => void importItem(row.id, true) };
                    }
                } }
        ];
    }
    function navigateReader(delta: number): void {
        const id = ids[articleIndex + delta];
        if (id) choose(id);
    }

    $effect(() => {
        if (sourcePageId || !tabId) return;
        const request = feedRequests.get(tabId);
        if (!request) return;
        untrack(() => {
            feedRequests.delete(tabId);
            if (request.kind === "add") {
                openForm();
                return;
            }
            want = request.id;
            keyword = applied = "";
            change({ scope: "all", read: "all" });
            void tick().then(() => {
                if (want && queryKey === previousQuery) void reload();
            });
        });
    });
    onMount(() => {
        const offMenu = tabId ? registerViewMenu(tabId, () => sourceActions(scope,
            activeTab()?.closest("[data-group-id]")?.querySelector<HTMLElement>("[data-tab-actions]") ?? undefined)) : undefined;
        const off = api.onChanged(queueReload);
        const offPages = window.api?.pages.onChanged(updateLinkedPapers);
        return () => {
            alive = false; off(); offPages?.(); offMenu?.();
            clearTimeout(reloadTimer); clearTimeout(openTimer);
            rowCache.start([], true);
        };
    });
</script>

<FeedLayout {params} fixed={!!sourcePageId} {reading} onwidth={change}>
    {#snippet heading()}
        {#if sourcePageId}
            <div class="source-heading">
                <h1>{sourceTitle || source?.name || t("shell.untitled")}</h1>
                {@render belowTitle?.()}
            </div>
        {/if}
    {/snippet}
    {#snippet toolbar(showScope, compact)}
        <FeedToolbar {scope} {choices} cancelled={cancelledChoices} {showScope} {compact} {pending} {refreshing} {canRefresh}
            {read} {order} bind:keyword onscope={scope => change({ scope })} onread={read => change({ read })}
            onorder={() => change({ order: order === "newest" ? "oldest" : "newest" })}
            onrefresh={() => refresh()} onadd={event => openForm(undefined, event.currentTarget as HTMLElement)} />
    {/snippet}
    {#snippet sources()}
        <FeedSources {scope} active={activeSources} cancelled={cancelledSources} {unread} {loaded} onscope={scope => change({ scope })}
            actions={sourceActions} pageActions={row => window.api ? pageMenu({ id: row.id, attributes: { pinned: row.pinned } }, history, [row.id], true) : []} />
    {/snippet}
    {#snippet list()}
        <FeedStatus {source} {followed} {keywords} total={ids.length} onkeywords={saveKeywords} onretry={refresh} />
        {#if error}
            <div class="feed-error" role="alert">{message(error)}
                {#if retry}<Button onclick={() => retry?.()}>{t("dialog.retry")}</Button>
                {:else}<Button variant="text" onclick={() => error = ""}>{t("dialog.close")}</Button>{/if}
            </div>
        {/if}
        <VirtualList bind:this={itemList} {ids} {pending} {selected} label={t("feed.items")} empty={t("feed.noItems")}
            onrange={range} onopen={choose} onmove={(id, holding) => choose(id, true, holding)}
            onsettle={() => choose(selected, true)} oncontext={context}>
            {#snippet row(id)}
                {@const item = rowCache.rows.get(id)}
                {#if item}<FeedRow {item} />{/if}
            {/snippet}
        </VirtualList>
    {/snippet}
    {#snippet reader(single)}
        <FeedReader bind:this={articleReader} item={detail} {single} shown={!single || reading} {importing} downloading={!!detail && downloads.has(detail.id)}
            previous={articleIndex > 0} next={articleIndex >= 0 && articleIndex < ids.length - 1}
            onback={back} onnavigate={navigateReader} onoriginal={openOriginal} onread={setRead}
            onimport={importItem} onpdf={fetchPDF} onpaper={openPaper}
            onposition={(id, value) => void operate(() => write(() => api.setPosition(id, value)))} />
    {/snippet}
</FeedLayout>

<Menu bind:open={menu} anchor={menuAnchor} first items={entries} onrestore={() => itemList?.focus()} />
{#if confirmation}
    <ConfirmDialog open={true} title={confirmation.title} body={confirmation.body} confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel} danger={confirmation.danger} oncancel={() => confirmation = undefined}
        onconfirm={() => {
            const action = confirmation?.run;
            confirmation = undefined;
            action?.();
        }} />
{/if}
<Dialog title={t(editing ? "feed.editSource" : "feed.addSource")} bind:open={formOpen} locked={saving} restoreFocus={restoreFormFocus}>
    {#key editing?.id}
        <SourceForm source={editing} pending={saving} error={formError} onsave={saveSource} oncancel={() => formOpen = false} />
    {/key}
</Dialog>

<style>
    .source-heading { padding: var(--ui-space-4) var(--ui-editor-gutter); }
    .source-heading h1 { margin: 0; font: 600 var(--ui-editor-font-title)/var(--ui-editor-heading-line-height) var(--ui-font-family); }
    .feed-error { display: flex; align-items: center; gap: var(--ui-space-2); min-height: var(--ui-row-height); padding-inline: var(--ui-space-3); color: var(--ui-danger); font-size: var(--ui-font-small); }
    .feed-error :global(button) { flex: none; }
</style>