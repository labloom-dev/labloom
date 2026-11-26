<script lang="ts">
    import { untrack, type Snippet } from "svelte";
    import type { ViewQuery, ViewSort } from "../../../shared/workspace/query";
    import { commands, isComposingKey } from "../../../shared/content/commands";
    import { t } from "../../i18n.svelte";
    import Input from "../base/Input.svelte";
    import Button from "../base/Button.svelte";
    import Popover from "../base/Popover.svelte";

    let { query, sort, keyword = $bindable(""), filterOpen = $bindable(false), pending, busy, empty, filters, sorts, groups, oncreate, onimport, onempty }: {
        keyword?: string; filterOpen?: boolean; query?: ViewQuery; busy: boolean; pending: boolean; empty: boolean;
        sort: ViewSort[];
        filters?: Snippet; sorts: Snippet; groups?: Snippet;
        oncreate?: () => void; onimport?: () => void; onempty?: () => void;
    } = $props();
    let draft = $state(untrack(() => keyword)), composingSearch = false;

    function composing(event: KeyboardEvent): void {
        if (isComposingKey(event) && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    }
</script>

<header class="library-toolbar">
    <div class="search" class:pending><Input search clearLabel={t("shell.clearFilter")} label={t("library.search")} placeholder={t("library.search")}
        bind:value={draft} oninput={value => {
            if (!composingSearch) keyword = value;
        }} inputProps={{
            oncompositionstart: () => composingSearch = true,
            oncompositionend: () => {
                composingSearch = false; keyword = draft;
            }
        }} /></div>
    {#if query && filters}
        <Popover label={t("library.filter")} bind:open={filterOpen} align="end" contentProps={{ onInteractOutside: event => {
            if ((event.target as Element | null)?.closest("[data-table-filter-chip]")) event.preventDefault();
        } }}>
            {#snippet trigger({ props })}<Button {...props} data-table-filters aria-pressed={!!query.conditions.length} onkeydown={composing}>{t("library.filter")}</Button>{/snippet}
            {@render filters()}
        </Popover>
    {/if}
    <Popover label={t("table.sort")} align="end">
        {#snippet trigger({ props })}<Button {...props} data-table-sort aria-pressed={!!sort.length} onkeydown={composing}>{t("table.sort")}</Button>{/snippet}
        {@render sorts()}
    </Popover>
    {#if query && groups}
        <Popover label={t("table.group")} align="end">
            {#snippet trigger({ props })}<Button {...props} data-table-group aria-pressed={!!query.group} onkeydown={composing}>{t("table.group")}</Button>{/snippet}
            {@render groups()}
        </Popover>
    {/if}
    {#if oncreate}<Button data-table-create aria-keyshortcuts={commands.newPage.shortcut} disabled={busy} onclick={oncreate}>{t("library.create")}</Button>{/if}
    {#if onimport}<Button data-table-import disabled={busy} onclick={onimport}>{t("command.importPDF")}</Button>{/if}
    {#if onempty}<Button disabled={busy || empty} onclick={onempty}>{t("library.emptyTrash")}</Button>{/if}
</header>

<style>
    .library-toolbar { display: flex; align-items: center; flex: none; gap: var(--ui-space-2); min-height: var(--ui-toolbar-height); padding-inline: var(--ui-space-2); border-bottom: var(--ui-stroke) solid var(--ui-divider); overflow-x: auto; }
    .pending::after { content: ""; position: absolute; inset: auto 0 0; height: var(--ui-active-border); background: var(--ui-accent); animation: progress 1s ease-in-out infinite alternate; transform-origin: left; }
    @keyframes progress { from { transform: scaleX(.2); } to { transform: scaleX(1); } }
    .search { position: relative; flex: 1; min-width: var(--ui-icon-large); }
    .search :global(.ui-field) { width: 100%; }
    header :global(button) { flex-shrink: 0; white-space: nowrap; }
    header :global([aria-pressed="true"]) { background: var(--ui-selected); color: var(--ui-text-selected); }
</style>