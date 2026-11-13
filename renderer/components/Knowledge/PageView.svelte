<section class="page-view">
    <header class="page-toolbar">
        {#if current.state.backlinks.length}<Popover.Root><Popover.Trigger>{current.state.backlinks.length} 个反向链接</Popover.Trigger><Popover.Portal><Popover.Content class="compact-menu" collisionPadding={6}>{#each current.state.backlinks as link (link.sourceId)}<button class="compact-item" onclick={event => openPage(link.sourceId, { otherGroup: event.ctrlKey })}>{link.title}{link.deleted ? "（已回收）" : ""}</button>{/each}</Popover.Content></Popover.Portal></Popover.Root>{/if}
        {#if current.state.error && !gone}<span class="failed" title={current.state.error}>保存失败：{current.state.error}</span>{/if}
        <div class="spacer"></div><button class:active={showProperties} onclick={() => showProperties = !showProperties}>属性</button>
        {#if page && !gone}<button disabled={syncing} onclick={trash}>{page.attributes.deleted ? "恢复页面" : "移入回收站"}</button>{/if}
    </header>
    {#if gone}<p class="recycled">页面已永久删除。</p>
    {:else if page}
        {#if page.attributes.deleted}
            <div class="recycled">此页面已在回收站中，恢复后可继续编辑。</div>
        {/if}
        {#if page.kind === "annotation" && typeof page.attributes.annotation_paper === "string"}
            <div class="origin">
                <button onclick={() => openPage(String(page!.attributes.annotation_paper), { anchorId: String(page!.attributes.annotation_anchor) })}>↗ 返回原文位置</button>
            </div>
        {/if}
        <div class="page-body">
            <div class="main-content">
                {#if page.kind === "paper"}
                    <div inert={syncing}><PaperPanel {page} session={current} tabId={tab.id} anchorId={tab.anchorId} /></div>
                {/if}
                <Editor session={current} tabId={tab.id} anchorId={tab.anchorId} />

            </div>
            {#if showProperties}
                <aside inert={syncing}>
                    <Properties session={current} definitions={current.state.definitions} />
                </aside>
            {/if}
        </div>
    {:else if !current.state.loading}
        <div class="empty-state">页面暂时无法读取。</div>
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
    .recycled, .origin { padding: 8px 26px; color: var(--c-muted); font-size: var(--font-secondary); background: var(--c-cream); }
    @container (max-width: 850px) { .page-body { flex-direction: column; } aside { width: 100%; border-left: 0; border-top: var(--border-width) solid var(--c-line); } }
</style>
<script lang="ts">
    import { Popover } from "bits-ui";
    import { dirtyPages } from "../Tab/dirty.svelte";
    import { untrack } from "svelte";
    import { type Tab } from "../Tab/defs";
    import { blockText } from "../../../shared/content/blocks";
    import { session, perform, knowledgeState } from "./state.svelte";
    import { readingTabs } from "../Tab/activity.svelte";
    import { openPage } from "../layout/navigation";
    import { updateTab } from "../Tab/api";
    import Editor from "../Editor/Editor.svelte";
    import Properties from "./Properties.svelte";
    import PaperPanel from "./PaperPanel.svelte";
    let { tab }: { tab: Extract<Tab, { type: "page" }> } = $props();
    $effect(() => {
        const dirty = current.state.dirty || current.state.saving;
        if (dirty) dirtyPages.set(tab.id + ":" + tab.pageId, tab.id); else dirtyPages.delete(tab.id + ":" + tab.pageId);
        return () => { dirtyPages.delete(tab.id + ":" + tab.pageId); };
    });
    const current = untrack(() => session(tab.id, tab.pageId));
    const page = $derived(current.state.page);
    const syncing = $derived(readingTabs.has(tab.id));
    let showProperties = $state(false), gone = $state(false);
    $effect(() => { if (knowledgeState.change.purged?.includes(tab.pageId)) { gone = true; current.release(); } });
    $effect(() => {
        if (page) {
            const title = blockText(page.blocks[page.titleBlockId]) || "未命名";
            untrack(() => {
                if (tab.title !== title) updateTab({ ...tab, title });
            });
        }
    });
    function trash(): void {
        void perform(() => current.action(token => page!.attributes.deleted ? window.api.knowledge.restore([tab.pageId], tab.id) : window.api.knowledge.trash([tab.pageId], tab.id, token)));
    }
</script>