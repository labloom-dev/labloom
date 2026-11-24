<script module lang="ts">
    import { tabState } from "../Tab/state.svelte";
    import type { Tab } from "../Tab/defs";
    import type { ListPosition } from "../base/VirtualList.svelte";

    type Position = { recent?: ListPosition; tasks?: ListPosition; feed?: ListPosition };
    const locations = new WeakMap<Tab, Position>();
    function locationFor(id: string): Position {
        const tab = tabState.groups.flatMap(group => group.tabs).find(tab => tab.id === id);
        const saved = tab && locations.get(tab);
        if (saved) return saved;
        const location: Position = {};
        if (tab) locations.set(tab, location);
        return location;
    }
</script>

<script lang="ts">
    import { onMount, tick, untrack, type Snippet } from "svelte";
    import { commands } from "../../../shared/content/commands";
    import { secondsToDay } from "../../../shared/content/time";
    import type { AttributeDefinition } from "../../../shared/types/attributes";
    import { feedBatchSize, type FeedItem } from "../../../shared/types/feed";
    import { defaultOverviewDate, defaultOverviewStatus, overviewBatchSize, type OverviewPage } from "../../../shared/workspace/overview";
    import { commandLabel, failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Menu, { type MenuItem } from "../base/Menu.svelte";
    import VirtualList from "../base/VirtualList.svelte";
    import { WindowRows } from "../base/window-rows";
    import FeedRow from "../Feed/FeedRow.svelte";
    import { formatDate } from "../Feed/labels";
    import { openFeed } from "../Feed/navigation";
    import { propertyName } from "../Knowledge/attribute-labels";
    import { perform } from "../Knowledge/feedback.svelte";
    import { kindIcons } from "../Knowledge/labels";
    import { importPapers } from "../Knowledge/library-import.svelte";
    import { pageMenu } from "../Knowledge/page-menu";
    import { runCommand } from "../layout/commands";
    import { openPage } from "../layout/navigation";
    import { currentTimeZone } from "../layout/preferences.svelte";
    import { navigationState } from "../Tab/persistence.svelte";
    import { registerViewMenu } from "../Tab/view-menu";
    import type { ViewProps } from "../Tab/views";
    import Icon from "../utils/Icon.svelte";

    let { tabId, params, onparams, source }: ViewProps<"overview"> = $props();
    const location = untrack(() => locationFor(tabId));
    const status = $derived(params.status ?? defaultOverviewStatus), date = $derived(params.date ?? defaultOverviewDate);
    let definitions = $state.raw<AttributeDefinition[]>([]);
    let tasks = $state.raw<string[]>([]), recent = $state.raw<OverviewPage[]>([]), unread = $state.raw<string[]>([]);
    let missingStatus = $state(false), pagesPending = $state(true), feedPending = $state(true);
    let pageError = $state<ErrorValue>(""), feedError = $state<ErrorValue>(""), definitionsError = $state<ErrorValue>("");
    const error = $derived(pageError || feedError || definitionsError);
    let taskList: VirtualList, recentList: VirtualList, feedList: VirtualList;
    const taskRows = new WindowRows<OverviewPage>(ids => window.api.pages.overviewRows(ids, date.id), cause => pageError = failure(cause));
    const feedRows = new WindowRows<FeedItem>(ids => window.api.feed.getRows(ids), cause => feedError = failure(cause));
    const history = $derived(new Map(navigationState.recentPages.toSorted((a, b) => b.openedAt - a.openedAt).map(row => [row.id, row.openedAt])));
    const recentIds = $derived(recent.map(page => page.id));
    const byId = $derived(new Map(recent.map(page => [page.id, page])));
    let alive = true, pagesVersion = 0, feedVersion = 0, definitionVersion = 0, now = $state(Date.now());
    let pagesLoaded = false, feedLoaded = false;
    const today = $derived(secondsToDay(now / 1000, currentTimeZone()));
    let pagesTimer: ReturnType<typeof setTimeout> | undefined, feedTimer: ReturnType<typeof setTimeout> | undefined;
    function range(ids: string[], rows: WindowRows<OverviewPage> | WindowRows<FeedItem>, size: number, first: number, end: number): void {
        void rows.request(ids.slice(Math.floor(first / size) * size, Math.ceil((end + 12) / size) * size));
    }
    async function loadPages(): Promise<void> {
        const version = ++pagesVersion;
        const at = pagesLoaded ? taskList?.position() : location.tasks;
        try {
            const next = await window.api.pages.overviewIndex({ status: status.id, date: date.id, recent: Array.from(history.keys()), around: at?.id });
            if (!alive || version !== pagesVersion) return;
            const taskAnchor = pagesLoaded ? taskList?.position() : location.tasks, openedAnchor = pagesLoaded ? recentList?.position() : location.recent;
            taskRows.start(next.tasks);
            recent = next.recent; tasks = next.taskIds; missingStatus = next.missingStatus;
            pagesLoaded = true; pageError = "";
            await tick();
            if (alive && version === pagesVersion) {
                taskList?.restorePosition(taskAnchor);
                recentList?.restorePosition(openedAnchor);
            }
        }
        catch (cause) {
            if (alive && version === pagesVersion) pageError = failure(cause);
        }
        finally {
            if (alive && version === pagesVersion) pagesPending = false;
        }
    }
    async function loadFeed(): Promise<void> {
        const version = ++feedVersion;
        const at = feedLoaded ? feedList?.position() : location.feed;
        try {
            const result = await window.api.feed.getState({ read: "unread" }, at?.id);
            if (!alive || version !== feedVersion) return;
            const anchor = feedLoaded ? feedList?.position() : location.feed;
            feedRows.start(result.items);
            unread = result.ids; feedLoaded = true; feedError = "";
            await tick();
            if (alive && version === feedVersion) feedList?.restorePosition(anchor);
        }
        catch (cause) {
            if (alive && version === feedVersion) feedError = failure(cause);
        }
        finally {
            if (alive && version === feedVersion) feedPending = false;
        }
    }
    async function loadDefinitions(): Promise<void> {
        const version = ++definitionVersion;
        try {
            const next = await window.api.attributes.definitions();
            if (alive && version === definitionVersion) {
                definitions = next;
                definitionsError = "";
            }
        }
        catch (cause) {
            if (alive && version === definitionVersion) definitionsError = failure(cause);
        }
    }
    $effect(() => {
        void status.id; void date.id; void history;
        untrack(() => void loadPages());
    });
    function header(): MenuItem[] {
        const states = definitions.filter(entry => entry.type === "status");
        const dates = definitions.filter(entry => entry.type === "day");
        return [
            { label: t("overview.chooseStatus"), disabled: !states.length, items: states.map(entry => ({
                label: propertyName(entry), checked: status.id === entry.id,
                onselect: () => onparams({ ...params, status: { kind: "attribute", type: "status", id: entry.id } })
            })) },
            { label: t("overview.chooseDate"), disabled: !dates.length, items: dates.map(entry => ({
                label: propertyName(entry), checked: date.id === entry.id,
                onselect: () => onparams({ ...params, date: { kind: "attribute", type: "day", id: entry.id } })
            })) }
        ];
    }
    onMount(() => {
        const offMenu = registerViewMenu(tabId, header);
        void loadDefinitions();
        void loadFeed();
        const offPages = window.api.pages.onChanged(change => {
            if (change.definition) void loadDefinitions();
            if (!change.definition && !change.pages.length && !change.purged?.length) return;
            clearTimeout(pagesTimer);
            pagesTimer = setTimeout(() => void loadPages(), 100);
        });
        const offFeed = window.api.feed.onChanged(() => {
            clearTimeout(feedTimer);
            feedTimer = setTimeout(() => void loadFeed(), 100);
        });
        const clock = setInterval(() => now = Date.now(), 60000);
        return () => {
            if (pagesLoaded) {
                location.tasks = taskList?.position();
                location.recent = recentList?.position();
            }
            if (feedLoaded) location.feed = feedList?.position();
            alive = false;
            offMenu(); offPages(); offFeed();
            clearTimeout(pagesTimer); clearTimeout(feedTimer); clearInterval(clock);
            taskRows.start([], true); feedRows.start([], true);
        };
    });

    let menu = $state(false), point = $state({ x: 0, y: 0 }), target = $state.raw<OverviewPage>();
    let contextList: VirtualList;
    const anchor = { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) };
    const entries = $derived(menu && target ? pageMenu({ id: target.id, attributes: { pinned: target.pinned } }, source, [target.id], true)
        .map(item => ({ label: item.label, shortcut: item.id === "open" ? item.shortcut : undefined, onselect: item.run })) : []);
    function context(page: OverviewPage | undefined, list: VirtualList, x: number, y: number): void {
        if (!page) return;
        contextList = list; target = page; point = { x, y }; menu = true;
    }
    function retry(): void {
        if (pageError) void loadPages();
        if (feedError) void loadFeed();
        if (definitionsError) void loadDefinitions();
    }
    const open = (id: string): void => openPage(id, { currentGroup: true });
</script>

{#snippet panel(title: string, count: number, list: Snippet)}
    <section class="panel" aria-label={title}>
        <header><h2>{title}</h2><span>{count}</span></header>
        {@render list()}
    </section>
{/snippet}

<section class="overview">
    <header class="overview-actions">
        <Button icon="add" onclick={() => runCommand("newPage")}>{commandLabel("newPage")} <kbd class="ui-shortcut">{commands.newPage.shortcut}</kbd></Button>
        <Button icon="book" onclick={() => void perform(() => importPapers(source))}>{commandLabel("importPDF")}</Button>
        <Button icon="rss" onclick={() => openFeed({ kind: "add" })}>{t("feed.addSource")}</Button>
    </header>
    {#if error}<div class="error" role="alert">{message(error)} <Button onclick={retry}>{t("dialog.retry")}</Button></div>{/if}
    <div class="overview-lists">
        {@render panel(t("overview.recent"), recentIds.length, recentRows)}
        {@render panel(t("overview.todo"), tasks.length, taskItems)}
        {@render panel(t("overview.unread"), unread.length, feedItems)}
    </div>
</section>

{#snippet recentRows()}
    <VirtualList bind:this={recentList} ids={recentIds} label={t("overview.recent")} empty={t("overview.noRecent")} pending={pagesPending}
        onrange={() => {}} onopen={open} oncontext={(id, x, y) => context(byId.get(id), recentList, x, y)}>
        {#snippet row(id)}
            {@const page = byId.get(id)}
            {#if page}
                <span class="page-title"><Icon name={kindIcons[page.kind]} size="var(--ui-icon-normal)" /><span data-list-label>{page.title || t("shell.untitled")}</span></span>
                <span class="page-meta" data-list-label>{formatDate(history.get(id) ?? null)}</span>
            {/if}
        {/snippet}
    </VirtualList>
{/snippet}
{#snippet taskItems()}
    <VirtualList bind:this={taskList} ids={tasks} label={t("overview.todo")} empty={t(missingStatus ? "overview.missingStatus" : "overview.noTodo")} pending={pagesPending}
        onrange={(first, end) => range(tasks, taskRows, overviewBatchSize, first, end)} onopen={open}
        oncontext={(id, x, y) => context(taskRows.rows.get(id), taskList, x, y)}>
        {#snippet row(id)}
            {@const page = taskRows.rows.get(id)}
            {#if page}
                <span class="page-title"><span data-list-label>{page.title || t("shell.untitled")}</span></span>
                {#if page.date !== null}
                    {@const day = secondsToDay(page.date)}
                    <time datetime={day} class="page-meta" class:overdue={day < today}>{day}</time>
                {/if}
            {/if}
        {/snippet}
    </VirtualList>
{/snippet}
{#snippet feedItems()}
    <VirtualList bind:this={feedList} ids={unread} label={t("overview.unread")} empty={t("overview.noUnread")} pending={feedPending}
        onrange={(first, end) => range(unread, feedRows, feedBatchSize, first, end)} onopen={id => openFeed({ kind: "item", id })}>
        {#snippet row(id)}
            {@const item = feedRows.rows.get(id)}
            {#if item}<FeedRow {item} overview />{/if}
        {/snippet}
    </VirtualList>
{/snippet}
<Menu bind:open={menu} {anchor} items={entries} first onrestore={() => contextList?.focus()} />

<style>
    .overview { height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--ui-text); background: var(--ui-surface-window); font-family: var(--ui-font-family); container-type: inline-size; }
    .overview-actions { display: flex; align-items: center; flex: none; min-height: var(--ui-toolbar-height); gap: var(--ui-space-3); padding: var(--ui-space-4); border-bottom: var(--ui-stroke) solid var(--ui-divider); overflow-x: auto; }
    .overview-actions :global(button) { flex: none; }
    .overview-lists { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .panel + .panel { border-inline-start: var(--ui-stroke) solid var(--ui-divider); }
    .panel header { display: flex; align-items: center; justify-content: space-between; flex: none; gap: var(--ui-space-3); min-height: var(--ui-toolbar-height); padding-inline: var(--ui-space-3); border-bottom: var(--ui-stroke) solid var(--ui-divider); font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    h2 { margin: 0; color: var(--ui-text); font-size: var(--ui-font-body); font-weight: 600; }
    .page-title { display: flex; align-items: center; gap: var(--ui-space-2); min-width: 0; font-size: var(--ui-font-body); line-height: 1.4; }
    .page-meta { color: var(--ui-text-secondary); font-size: var(--ui-font-small); line-height: 1.4; }
    [data-list-label] { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .overdue { color: var(--ui-warning); }
    .error { display: flex; align-items: center; gap: var(--ui-space-2); padding-inline: var(--ui-space-3); color: var(--ui-danger); }
    @container (max-width: 760px) {
        .overview-lists { display: flex; flex-direction: column; overflow: auto; }
        .panel { flex: 0 0 clamp(12em, 40vh, 23em); }
        .panel + .panel { border-inline-start: 0; border-block-start: var(--ui-stroke) solid var(--ui-divider); }
    }
</style>