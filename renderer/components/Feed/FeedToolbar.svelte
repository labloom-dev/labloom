<script lang="ts">
    import type { FeedRead, FeedOrder } from "../../../shared/types/feed";
    import type { FeedScope } from "../../../shared/workspace/feed";
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Input from "../base/Input.svelte";
    import Select, { type SelectOption } from "../base/Select.svelte";

    let { scope, choices, cancelled, showScope, compact, pending, refreshing, canRefresh, read, order, keyword = $bindable(""),
        onscope, onread, onorder, onrefresh, onadd }: {
        scope: FeedScope; choices: SelectOption[]; cancelled: SelectOption[]; showScope: boolean; compact: boolean;
        pending: boolean; refreshing: boolean; canRefresh: boolean; read: FeedRead; order: FeedOrder; keyword?: string;
        onscope: (value: FeedScope) => void; onread: (value: FeedRead) => void;
        onorder: () => void; onrefresh: () => void; onadd: (event: MouseEvent) => void;
    } = $props();
    const filters = $derived([
        { value: "all", label: t("feed.allReadStates") },
        { value: "unread", label: t("feed.unread") },
        { value: "read", label: t("feed.read") }
    ]);
</script>

<header class="feed-toolbar">
    {#if showScope}
        <div class="scope">
            <Select label={t("feed.sources")} options={choices} groups={cancelled.length ? [{ label: t("feed.cancelledSources"), options: cancelled }] : []}
                value={scope} placeholder={t("feed.noSources")} disabled={!choices.length} onchange={value => onscope(value as FeedScope)} />
        </div>
    {/if}
    <div class="search" class:pending>
        <Input search clearLabel={t("shell.clearFilter")} label={t("feed.search")} placeholder={t("feed.search")} bind:value={keyword} />
    </div>
    <Select label={t("feed.readFilter")} options={filters} value={read} onchange={value => onread(value as FeedRead)} />
    <IconButton icon={order === "newest" ? "arrow-down" : "arrow-up"} label={t(order === "newest" ? "feed.newest" : "feed.oldest")} onclick={onorder} />
    <IconButton icon={refreshing ? "loading" : "refresh"} label={t(refreshing ? "feed.refreshing" : "feed.refreshAll")}
        aria-busy={refreshing} disabled={refreshing || !canRefresh} onclick={onrefresh} />
    {#if compact}<IconButton icon="add" label={t("feed.addSource")} data-feed-add onclick={onadd} />
    {:else}<Button icon="add" data-feed-add onclick={onadd}>{t("feed.addSource")}</Button>{/if}
</header>

<style>
    .feed-toolbar { display: flex; align-items: center; flex: none; gap: var(--ui-space-2); min-height: var(--ui-toolbar-height); padding-inline: var(--ui-space-2); border-bottom: var(--ui-stroke) solid var(--ui-divider); overflow-x: auto; }
    .scope { min-width: 0; max-width: 30%; display: flex; }
    .scope :global(.ui-select) { min-width: 0; }
    .search { position: relative; flex: 1; min-width: var(--ui-icon-large); }
    .search :global(.ui-field) { width: 100%; }
    .pending::after { content: ""; position: absolute; inset: auto 0 0; height: var(--ui-active-border); background: var(--ui-accent); animation: progress 1s ease-in-out infinite alternate; transform-origin: left; }
    @keyframes progress { from { transform: scaleX(.2); } to { transform: scaleX(1); } }
    header :global(button) { white-space: nowrap; }
</style>