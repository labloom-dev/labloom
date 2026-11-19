<section class="page-view">
    <header class="page-toolbar">
        {#if current.state.backlinks.length}<Popover.Root><Popover.Trigger>{current.state.backlinks.length} 个反向链接</Popover.Trigger><Popover.Portal><Popover.Content class="compact-menu" collisionPadding={6}>{#each current.state.backlinks as link (link.sourceId)}<button class="compact-item" onclick={event => openPage(link.sourceId, { otherGroup: event.ctrlKey })}>{link.title}{link.deleted ? "（已回收）" : ""}</button>{/each}</Popover.Content></Popover.Portal></Popover.Root>{/if}
        {#if current.state.error && !gone}<span class="failed" title={message(current.state.error)}>{message(current.state.error)}</span>{/if}
        <div class="spacer"></div><button class:active={showProperties} onclick={() => showProperties = !showProperties}>属性</button>
        {#if page && !gone}<button disabled={syncing} onclick={trash}>{page.attributes.deleted ? "恢复页面" : "移入回收站"}</button>{/if}
    </header>
    {#if gone || current.state.error && current.state.error.kind === "page-unavailable"}
        <p class="recycled">找不到此页面。<button class="text-button" onclick={() => picking = true}>选择页面</button></p>
        {#if picking}<TargetPicker mode="page" onclose={() => picking = false} onselect={target => {
            current.release();
            onparams({ page: { kind: "page", id: target.id } });
        }} />{/if}
    {:else if page}
        {#if page.attributes.deleted}
            <div class="recycled">此页面已在回收站中，恢复后可继续编辑。</div>
        {/if}
        <div class="page-body">
            <div class="main-content">
                {#if page.kind === "paper"}
                    <div inert={syncing}><PaperPanel {page} session={current} {tabId} /></div>
                {/if}
                {#if page.kind === "feed"}<FeedView sourcePageId={page.id} />{:else}<Editor session={current} {tabId} pageAnchor />{/if}

            </div>
            {#if showProperties}
                <aside inert={syncing}>
                    <Properties session={current} definitions={current.state.definitions} />
                </aside>
            {/if}
        </div>
    {:else if !current.state.loading}
        <div class="empty-state">{t("failure.page-unavailable")}</div>
    {/if}
</section>
<style>
    .page-view { display: flex; flex-direction: column; min-height: 100%; background: var(--c-paper); }
    .page-toolbar { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 6px; height: var(--pagebar-height); flex-shrink: 0; padding-inline: 8px; border-bottom: var(--border-width) solid var(--c-line); background: var(--c-paper); font-size: var(--font-secondary); }
    .page-toolbar :global(button) { height: var(--button-height); padding-inline: 6px; border-radius: var(--control-radius); white-space: nowrap; }
    .page-toolbar :global(button:hover), .active { background: var(--c-sage); }
    .spacer { flex: 1; }
    .failed { color: var(--c-reader-error-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .page-body { display: flex; min-width: 0; flex: 1; }
    .main-content { min-width: 0; flex: 1; }
    aside { width: 310px; flex-shrink: 0; border-left: var(--border-width) solid var(--c-line); }
    .recycled { padding: 8px 26px; color: var(--c-muted); font-size: var(--font-secondary); background: var(--c-cream); }
    @container (max-width: 850px) { .page-body { flex-direction: column; } aside { width: 100%; border-left: 0; border-top: var(--border-width) solid var(--c-line); } }
</style>
<script lang="ts">
    import { message, t } from "../../i18n.svelte";
    import { Popover } from "bits-ui";
    import { dirtyPages } from "../Tab/dirty.svelte";
    import { untrack } from "svelte";
    import type { ViewProps } from "../Tab/views";
    import TargetPicker from "./TargetPicker.svelte";
    import { session } from "./page-sessions";
    import { perform, knowledgeState } from "./feedback.svelte";
    import { readingTabs } from "../Tab/activity.svelte";
    import FeedView from "../Feed/FeedView.svelte";
    import { openPage } from "../layout/navigation";
    import Editor from "../Editor/Editor.svelte";
    import Properties from "./Properties.svelte";
    import PaperPanel from "./PaperPanel.svelte";
    let { tabId, params, source, onparams }: ViewProps<"page"> = $props();
    let picking = $state(false);
    const pageId = $derived(params.page.id);
    $effect(() => {
        const dirty = current.state.dirty || current.state.saving;
        if (dirty) dirtyPages.set(tabId + ":" + pageId, tabId); else dirtyPages.delete(tabId + ":" + pageId);
        return () => { dirtyPages.delete(tabId + ":" + pageId); };
    });
    const current = untrack(() => session(tabId, pageId, source));
    const page = $derived(current.state.page);
    const syncing = $derived(readingTabs.has(tabId));
    let showProperties = $state(false), gone = $state(false);
    $effect(() => { if (knowledgeState.change.purged?.includes(pageId)) { gone = true; current.release(); } });
    function trash(): void {
        void perform(() => current.action((token, writeId) => page!.attributes.deleted ? window.api.pages.restore([pageId], current.source, writeId) : window.api.pages.trash([pageId], current.source, token, writeId)));
    }
</script>