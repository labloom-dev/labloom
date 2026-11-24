<section class="page-view" class:reader-page={page?.kind === "paper" && !gone} class:feed-page={page?.kind === "feed" && !gone}>
    <PageStatus recycled={!!page?.attributes.deleted && !gone} error={gone || missing ? "" : message(current.state.error)} busy={syncing} onrestore={() => toggleTrash(current)} />
    {#if gone || missing}
        <div class="missing-page">{t("editor.missingPage")}<Button onclick={() => picking = true}>{t("editor.choosePage")}</Button></div>
        {#if picking}<TargetPicker mode="page" onclose={() => picking = false} onselect={target => {
            picking = false;
            current.release();
            onparams({ ...params, page: { kind: "page", id: target.id } });
        }} />{/if}
    {:else if page?.kind === "paper"}
        <PaperPanel {params} {onparams} {page} session={current} {tabId} {syncing} />
    {:else if page}
        <div class="page-body">
            <div class="main-content">
                {#if page.kind === "feed"}<FeedView {tabId} {source} sourcePageId={page.id} sourceTitle={page.title}>
                    {#snippet belowTitle()}<Backlinks links={current.state.backlinks} onopen={(id, otherGroup, anchorId) => openPage(id, { currentGroup: true, otherGroup, anchorId })} />{/snippet}
                </FeedView>{:else}<Editor session={current} {tabId} pageAnchor />{/if}

            </div>
            {#if params.showProperties}
                <aside inert={syncing}>
                    <Properties {page} session={current} definitions={current.state.definitions} disabled={current.state.loading}
                        onattr={current.attr} ondetach={current.detach} />
                </aside>
            {/if}
        </div>
    {:else if !current.state.loading}
        <div class="missing-page">{t("failure.page-unavailable")}</div>
    {/if}
</section>
<style>
    .page-view { display: flex; flex-direction: column; min-height: 100%; background: var(--ui-surface-window); color: var(--ui-text); container-type: inline-size; }
    .reader-page, .feed-page { height: 100%; min-height: 0; }
    .feed-page :is(.page-body, .main-content) { min-height: 0; }
    .feed-page aside { overflow: auto; }
    .page-body { display: flex; min-width: 0; flex: 1; }
    .main-content { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    aside { width: var(--ui-properties-width); flex-shrink: 0; border-left: var(--ui-stroke) solid var(--ui-divider); }
    .missing-page { display: flex; align-items: center; gap: var(--ui-space-4); padding: var(--ui-space-4) var(--ui-editor-gutter); color: var(--ui-text-secondary); }
    @container (max-width: 850px) { .page-body { flex-direction: column; } aside { width: 100%; border-left: 0; border-top: var(--ui-stroke) solid var(--ui-divider); } .feed-page aside { max-height: 36%; } }
</style>
<script lang="ts">
    import { message, t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Backlinks from "./Backlinks.svelte";
    import PageStatus from "./PageStatus.svelte";
    import { toggleTrash } from "./page-header";
    import { dirtyPages } from "../Tab/dirty.svelte";
    import { untrack } from "svelte";
    import type { ViewProps } from "../Tab/views";
    import TargetPicker from "./TargetPicker.svelte";
    import { session } from "./page-sessions";
    import { knowledgeState } from "./feedback.svelte";
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
        return () => {
            dirtyPages.delete(tabId + ":" + pageId);
        };
    });
    const current = untrack(() => session(tabId, pageId, source));
    const page = $derived(current.state.page);
    const syncing = $derived(readingTabs.has(tabId));
    let gone = $state(false);
    const missing = $derived(!!current.state.error && current.state.error.kind === "page-unavailable");
    $effect(() => {
        if (knowledgeState.change.purged?.includes(pageId)) {
            gone = true; current.release();
        }
    });
</script>