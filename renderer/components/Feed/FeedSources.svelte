<script lang="ts">
    import { tick } from "svelte";
    import { feedShortcuts, isComposingKey } from "../../../shared/content/commands";
    import type { FeedSource } from "../../../shared/types/feed";
    import type { FeedScope } from "../../../shared/workspace/feed";
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import ListRow from "../base/ListRow.svelte";
    import Menu, { type MenuItem } from "../base/Menu.svelte";
    import Icon from "../utils/Icon.svelte";

    let { scope, active, cancelled, unread, loaded, onscope, actions, pageActions }: {
        scope: FeedScope; active: FeedSource[]; cancelled: FeedSource[]; unread: number; loaded: boolean;
        onscope: (scope: FeedScope) => void;
        actions: (scope: FeedScope, opener?: HTMLElement) => MenuItem[];
        pageActions: (source: FeedSource) => ReturnType<typeof import("../Knowledge/page-menu").pageMenu>;
    } = $props();
    let expanded = $state(false);
    $effect(() => {
        if (cancelled.some(source => source.id === scope)) expanded = true;
    });

    let menu = $state(false), target = $state<FeedScope>("all"), point = $state({ x: 0, y: 0 });
    let returnFocus: HTMLElement | undefined;
    const menuAnchor = { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) };
    const entries = $derived.by((): MenuItem[] => {
        if (!menu) return [];
        const source = active.find(row => row.id === target) ?? cancelled.find(row => row.id === target);
        const subscription = actions(target, returnFocus);
        const pages = source ? pageActions(source).map(({ id, shortcut, ...item }) => ({ ...item, shortcut: id === "open" ? undefined : shortcut, onselect: item.run })) : [];
        return [...subscription, ...(pages.length && subscription.length ? [{ separator: true } as const] : []), ...pages];
    });

    function showMenu(value: FeedScope, button: HTMLElement, x: number, y: number): void {
        if (value === "followed") return;
        button.focus({ preventScroll: true });
        returnFocus = button;
        target = value; point = { x, y }; menu = true;
    }
    function context(event: MouseEvent, value: FeedScope): void {
        if (value === "followed") return;
        event.preventDefault();
        showMenu(value, event.currentTarget as HTMLElement, event.clientX, event.clientY);
    }
    function keys(event: KeyboardEvent): void {
        if (event.defaultPrevented || menu || !(event.target instanceof HTMLElement)) return;
        const button = event.target.closest<HTMLElement>("[data-scope]");
        if (!button) return;
        if (isComposingKey(event)) {
            if (event.key === "Enter" || event.key === " ") event.preventDefault();
            return;
        }
        const current = button.dataset.scope as FeedScope, key = event.key;
        if (key === "ContextMenu" || event.shiftKey && key === feedShortcuts.menu) {
            if (current === "followed") return;
            const rect = button.getBoundingClientRect();
            showMenu(current, button, rect.left, rect.bottom);
        }
        else if (event.ctrlKey && key === "Enter" || key === "Delete") {
            const source = active.find(row => row.id === current) ?? cancelled.find(row => row.id === current);
            const item = source && pageActions(source).find(item => item.id === (key === "Delete" ? "trash" : "openSide"));
            if (!item) return;
            item.run();
        }
        else if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        else if (key === feedShortcuts.previous || key === feedShortcuts.next) {
            const nav = event.currentTarget as HTMLElement;
            const rows = Array.from(nav.querySelectorAll<HTMLElement>("[data-scope]"));
            const index = rows.indexOf(button);
            const next = rows[Math.max(0, Math.min(rows.length - 1, index + (key === feedShortcuts.next ? 1 : -1)))];
            onscope(next.dataset.scope as FeedScope);
            void tick().then(() => next.focus());
        }
        else return;
        event.preventDefault();
        event.stopPropagation();
    }
</script>

{#snippet row(value: FeedScope, label: string, count?: number, source?: FeedSource)}
    <div class:paused={source?.status === "paused"} class="source-row">
        <ListRow title={label} selected={scope === value} onclick={() => onscope(value)}
            buttonProps={{ "data-scope": value, oncontextmenu: event => context(event, value) }}>
            <span class="source-name">{label}</span>
            {#if source?.refreshing}<span role="img" aria-label={t("feed.refreshing")}><Icon name="loading" size="var(--ui-icon-small)" /></span>{/if}
            {#if source?.status === "paused"}<span role="img" aria-label={t("feed.paused")}><Icon name="debug-pause" size="var(--ui-icon-small)" /></span>{/if}
            {#if source?.error}<span class="failed" role="img" aria-label={t("feed.refreshFailed")}><Icon name="warning" size="var(--ui-icon-small)" /></span>{/if}
            {#if count !== undefined}<span class="unread">{count}</span>{/if}
        </ListRow>
    </div>
{/snippet}

<nav class="feed-sources" aria-label={t("feed.sources")} onkeydown={keys}>
    {#if active.length || cancelled.length}
        {@render row("all", t("feed.all"), unread)}
        {@render row("followed", t("feed.followed"))}
        {#each active as source (source.id)}{@render row(source.id, source.name || t("shell.untitled"), source.unreadCount, source)}{/each}
        {#if cancelled.length}
            <Button class="cancelled" variant="text" icon={expanded ? "chevron-down" : "chevron-right"} aria-expanded={expanded}
                onclick={() => expanded = !expanded}>{t("feed.cancelledSources")}</Button>
            {#if expanded}
                {#each cancelled as source (source.id)}{@render row(source.id, source.name || t("shell.untitled"), source.unreadCount, source)}{/each}
            {/if}
        {/if}
    {:else if loaded}
        <div class="empty">{t("feed.noSources")}</div>
    {/if}
</nav>
<Menu bind:open={menu} anchor={menuAnchor} first items={entries} onrestore={() => returnFocus?.focus({ preventScroll: true })} />

<style>
    .feed-sources { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: var(--ui-space-2); }
    .feed-sources :global(.ui-row) { display: flex; }
    .source-row :global(.ui-row-main) { flex: 1; min-width: 0; }
    .source-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .paused .source-name, .unread, .empty { color: var(--ui-text-secondary); }
    .failed { color: var(--ui-warning); }
    .unread, .empty { font-size: var(--ui-font-small); }
    .unread { font-variant-numeric: tabular-nums; }
    .empty { padding-inline: var(--ui-space-3); }
    :global(button.cancelled) { max-width: 100%; font-size: var(--ui-font-small); }
</style>