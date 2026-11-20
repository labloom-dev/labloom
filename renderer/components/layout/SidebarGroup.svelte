<PanelGroup {groupKey} {title} {expanded} busy={pending} ontoggle={() => toggleGroup(groupKey)}>
    {#each rows as page (page.id)}
        <Menu context items={pageMenu(page, workspaceHistory, [page.id], true).map(item => ({ ...item, onselect: item.run }))}>
            {#snippet trigger({ props })}
                {@const caption = page.title || t("shell.untitled")}
                <ListRow icon={kindIcons[page.kind]} title={caption} selected={page.id === currentPage}
                    buttonProps={{ ...props, tabindex: -1, "data-panel-node": "page", "data-panel-key": groupKey + "/" + page.id }}
                    onclick={event => openPage(page.id, { currentGroup: true, otherGroup: event.ctrlKey })}>
                    <Tooltip text={caption}>{#snippet trigger({ props: tip })}<span {...tip} class="ui-row-title">{caption}</span>{/snippet}</Tooltip>
                </ListRow>
            {/snippet}
        </Menu>
    {/each}
    {#if more}<Button class="more" variant="text" data-panel-node="more" data-panel-key={groupKey + "/more"} tabindex={-1}
        aria-disabled={pending} onclick={() => {
            if (!pending) void load(false);
        }}>{t("shell.more")}</Button>{/if}
    {#if error}<p role="alert">{message(error)}</p>{/if}
</PanelGroup>

<style>
    :global(.panel-rows .more) { width: 100%; height: var(--ui-row-height); justify-content: flex-start; padding-inline-start: var(--ui-space-6); color: var(--ui-text-secondary); }
    p { padding-inline: var(--ui-space-3); color: var(--ui-danger); font-size: var(--ui-font-small); }
</style>
<script lang="ts">
    import { failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import { untrack } from "svelte";
    import type { PageSummary, PageQuery } from "../../../shared/types/content";
    import { knowledgeState } from "../Knowledge/feedback.svelte";
    import { pageMenu } from "../Knowledge/page-menu";
    import { kindIcons } from "../Knowledge/labels";
    import { openPage } from "./navigation";
    import { workspaceHistory } from "../../../shared/history/ipc";
    import ListRow from "../base/ListRow.svelte";
    import Menu from "../base/Menu.svelte";
    import Tooltip from "../base/Tooltip.svelte";
    import Button from "../base/Button.svelte";
    import PanelGroup from "./PanelGroup.svelte";
    import { navigationState, toggleGroup } from "../Tab/persistence.svelte";
    let { groupKey, title, query, keyword, currentPage }: { groupKey: string; title: string; query: PageQuery; keyword: string; currentPage?: string } = $props();
    const expanded = $derived(navigationState.expandedGroups.includes(groupKey));
    let rows = $state<PageSummary[]>([]), pending = $state(false), more = $state(false), error = $state<ErrorValue>("");
    let offset = 0, generation = 0;
    $effect(() => {
        void query; void keyword;
        if (expanded) untrack(() => void load(true));
        return () => {
            generation++;
        };
    });
    let seenSequence = 0;
    let refreshing = false;
    // Only notification ids are queued here; rendered rows remain reactive above.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const changedIds = new Set<string>();
    // Notification block ids are not rendered.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const changedBlockIds = new Set<string>();
    $effect(() => {
        const change = knowledgeState.change;
        if (change.seq === seenSequence) return;
        seenSequence = change.seq;
        if (!expanded) return;
        untrack(() => {
            for (const id of change.summaryPages ?? change.pages) changedIds.add(id);
            for (const id of change.blocks) changedBlockIds.add(id);
            if (changedIds.size) void refreshRows();
        });
    });
    async function refreshRows(): Promise<void> {
        if (refreshing) return;
        refreshing = true;
        const token = generation;
        try {
            while (changedIds.size && token === generation) {
                const changed = new Set(changedIds), blockIds = [...changedBlockIds]; changedIds.clear(); changedBlockIds.clear();
                const filter = keyword.trim().toLocaleLowerCase();
                if (filter) {
                    const matched: PageSummary[] = [];
                    const ids = [...changed];
                    for (let i = 0; i < ids.length; i += 200) matched.push(...(await window.api.pages.list({ ...JSON.parse(JSON.stringify(query)), ids: ids.slice(i, i + 200), limit: 200 })).items.filter(page => page.title.toLocaleLowerCase().includes(filter)));
                    if (token !== generation) return;
                    rows = [...rows.filter(page => !changed.has(page.id)), ...matched].sort((a, b) => Number(b.attributes.modified_at) - Number(a.attributes.modified_at) || a.id.localeCompare(b.id));
                }
                else {
                    const count = Math.max(40, rows.length), order: string[] = [];
                    // This lookup only assembles one response; it is not rendered.
                    // eslint-disable-next-line svelte/prefer-svelte-reactivity
                    const cache = new Map(rows.map(page => [page.id, page]));
                    // This temporary lookup only records ids within one metadata refresh.
                    // eslint-disable-next-line svelte/prefer-svelte-reactivity
                    const unchangedTitles = new Set<string>();
                    // This panel renders titles and values, never body excerpts. Ordinary text edits
                    // can update metadata without hydrating all ten thousand blocks for a summary.
                    if (blockIds.length <= 20) {
                        for (const id of [...changed].filter(id => cache.has(id))) {
                            const objects = await window.api.pages.readObjects(id, [id, ...blockIds]);
                            if (token !== generation) return;
                            if (objects.page && !objects.blocks.some(block => block.type === "title")) {
                                cache.set(id, { ...cache.get(id)!, attributes: objects.page.attributes });
                                unchangedTitles.add(id);
                            }
                        }
                    }
                    let total = 0;
                    for (let i = 0; i < count; i += 200) {
                        const unchanged = rows.slice(i, i + 200).filter(page => !changed.has(page.id) || unchangedTitles.has(page.id)).map(page => page.id);
                        const result = await window.api.pages.listUpdates({ ...JSON.parse(JSON.stringify(query)), offset: i, limit: Math.min(200, count - i) }, unchanged);
                        if (token !== generation) return;
                        order.push(...result.order); total = result.total;
                        for (const page of result.items) cache.set(page.id, page);
                    }
                    rows = order.map(id => cache.get(id)!); offset = order.length; more = offset < total;
                }
            }
        }
        catch (problem) {
            if (token === generation) error = failure(problem);
        }
        finally {
            refreshing = false; if (changedIds.size) void refreshRows();
        }
    }
    async function load(reset: boolean): Promise<void> {
        const current = ++generation, filter = keyword.trim().toLocaleLowerCase();
        if (reset) {
            offset = 0; rows = [];
        }
        pending = true;
        try {
            let found: PageSummary[] = [];
            do {
                const result = await window.api.pages.list({ ...JSON.parse(JSON.stringify(query)), offset, limit: filter ? 200 : 40 });
                if (current !== generation) return;
                offset += result.items.length;
                found = [...found, ...result.items.filter(page => !filter || page.title.toLocaleLowerCase().includes(filter))];
                more = offset < result.total && !!result.items.length;
            } while (filter && found.length < 40 && more);
            rows = [...rows, ...found]; error = "";
        }
        catch (problem) {
            if (current === generation) error = failure(problem);
        }
        finally {
            if (current === generation) pending = false;
        }
    }
</script>