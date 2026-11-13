<section aria-busy={pending}>
    <button class="group-name" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? "⌄" : "›"} {title}</button>
    {#if expanded}
        {#each rows as page (page.id)}
            <ContextActions items={pageMenu(page, tabId())}>
                <button class="page" title={page.title} onclick={event => openPage(page.id, { otherGroup: event.ctrlKey })}><Icon name={kindIcons[page.kind]} size={16} /><span>{page.title || "未命名"}</span></button>
            </ContextActions>
        {/each}
        {#if more}<button class="page more" disabled={pending} onclick={() => void load(false)}>更多…</button>{/if}
        {#if error}<p class="error">{error}</p>{/if}
    {/if}
</section>
<style>
    .group-name, .page { display: flex; align-items: center; gap: 6px; width: 100%; height: var(--panel-row-height); font-size: var(--font-body); padding-inline: var(--panel-indent); text-align: left; }
    .group-name { font-weight: 700; }
    .page { padding-left: calc(var(--panel-indent) * 2); }
    .page:hover, .group-name:hover { background: var(--c-sage); }
    .page span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .more { color: var(--c-muted); }
    p { padding-inline: var(--panel-indent); font-size: var(--font-secondary); }
</style>
<script lang="ts">
    import { untrack } from "svelte";
    import type { PageSummary, PageQuery } from "../../../shared/types/content";
    import { knowledgeState, message } from "../Knowledge/state.svelte";
    import { pageMenu } from "../Knowledge/page-menu";
    import { kindIcons } from "../Knowledge/labels";
    import { openPage } from "./navigation";
    import { tabState } from "../Tab/state.svelte";
    import Icon from "../utils/Icon.svelte";
    import ContextActions from "../utils/ContextActions.svelte";
    let { title, query, keyword, initiallyOpen = false }: { title: string; query: PageQuery; keyword: string; initiallyOpen?: boolean } = $props();
    let expanded = $state(untrack(() => initiallyOpen)), rows = $state<PageSummary[]>([]), pending = $state(false), more = $state(false), error = $state("");
    let offset = 0, generation = 0;
    const tabId = (): string => tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId ?? "";
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
                    for (let i = 0; i < ids.length; i += 200) matched.push(...(await window.api.knowledge.list({ ...JSON.parse(JSON.stringify(query)), ids: ids.slice(i, i + 200), limit: 200 })).items.filter(page => page.title.toLocaleLowerCase().includes(filter)));
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
                            const objects = await window.api.knowledge.readObjects(id, [id, ...blockIds]);
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
                        const result = await window.api.knowledge.listUpdates({ ...JSON.parse(JSON.stringify(query)), offset: i, limit: Math.min(200, count - i) }, unchanged);
                        if (token !== generation) return;
                        order.push(...result.order); total = result.total;
                        for (const page of result.items) cache.set(page.id, page);
                    }
                    rows = order.map(id => cache.get(id)!); offset = order.length; more = offset < total;
                }
            }
        }
        catch (problem) {
            if (token === generation) error = message(problem);
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
                const result = await window.api.knowledge.list({ ...JSON.parse(JSON.stringify(query)), offset, limit: filter ? 200 : 40 });
                if (current !== generation) return;
                offset += result.items.length;
                found = [...found, ...result.items.filter(page => !filter || page.title.toLocaleLowerCase().includes(filter))];
                more = offset < result.total && !!result.items.length;
            } while (filter && found.length < 40 && more);
            rows = [...rows, ...found]; error = "";
        }
        catch (problem) {
            if (current === generation) error = message(problem);
        }
        finally {
            if (current === generation) pending = false;
        }
    }
</script>