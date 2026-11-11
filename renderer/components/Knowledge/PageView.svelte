<section class="page-view">
    <header class="page-toolbar">
        <div class="save-state" class:failed={!!current.state.error}>{current.state.loading ? "正在读取…" : current.state.saving ? "正在保存…" : current.state.dirty ? "未保存" : "已保存"}</div>
        <button disabled={syncing || (!current.state.dirty && !current.state.history.canUndo)} onclick={() => current.undo("undo")}>撤销</button>
        <button disabled={syncing || !current.state.history.redo.length} onclick={() => current.undo("redo")}>重做</button>
        {#if current.state.history.redo.length > 1}
            <select value="" disabled={syncing} onchange={event => void current.undo("redo", event.currentTarget.value)}>
                <option value="">选择重做分支</option>
                {#each current.state.history.redo as branch (branch.id)}
                    <option value={branch.id}>{displayMilliseconds(branch.time)}</option>
                {/each}
            </select>
        {/if}
        <div class="spacer"></div>
        <button onclick={() => openPage(tab.pageId, { duplicate: true })}>另开标签页</button>
        <button class:active={showProperties} onclick={() => showProperties = !showProperties}>属性</button>
        {#if page}
            <button disabled={syncing} onclick={trash}>{page.attributes.deleted ? "恢复页面" : "移入回收站"}</button>
        {/if}
        <div class="format-dock" bind:this={dock}></div>
    </header>
    {#if current.state.error}
        <div class="notice error">{current.state.error}</div>
    {/if}
    {#if page}
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
                <Editor session={current} tabId={tab.id} {dock} />
                <section class="backlinks">
                    <h3>引用此页</h3>
                    {#each current.state.backlinks as link (link.sourceId)}
                        <button onclick={() => openPage(link.sourceId)}>{link.title}{link.deleted ? "（已回收）" : ""}</button>
                    {:else}
                        <p>还没有其他页面引用此页。</p>
                    {/each}
                </section>
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
    .page-toolbar { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 18px; border-bottom: 1px solid var(--c-line); background: var(--c-paper); font-size: 11px; }
    .page-toolbar button { padding: 5px 7px; border-radius: 5px; }
    .page-toolbar button:hover, .active { background: var(--c-sage); }
    .format-dock { flex: 1 0 100%; height: 39px; }
    .spacer { flex: 1; }
    .save-state { color: var(--c-muted); }
    .failed { color: var(--c-reader-error-text); }
    .page-body { display: flex; min-width: 0; flex: 1; }
    .main-content { min-width: 0; flex: 1; }
    aside { width: 310px; flex-shrink: 0; border-left: 1px solid var(--c-line); }
    .notice { margin: 14px; }
    .recycled, .origin { padding: 12px 26px; color: var(--c-muted); font-size: 12px; background: var(--c-cream); }
    .backlinks { padding: 20px 40px 40px; border-top: 1px dashed var(--c-line); font-size: 12px; }
    h3 { font-size: 13px; }
    .backlinks button { display: block; margin: 8px 0; text-align: left; }
    .backlinks p { color: var(--c-muted); }
    @container (max-width: 850px) { .page-body { flex-direction: column; } aside { width: 100%; border-left: 0; border-top: 1px solid var(--c-line); } }
</style>
<script lang="ts">
    import { displayMilliseconds } from "../layout/preferences.svelte";
    import { untrack } from "svelte";
    import { type Tab } from "../Tab/defs";
    import { blockText } from "../../../shared/content/blocks";
    import { session, perform } from "./state.svelte";
    import { readingTabs } from "../Tab/activity.svelte";
    import { openPage } from "../layout/navigation";
    import { updateTab } from "../Tab/api";
    import Editor from "../Editor/Editor.svelte";
    import Properties from "./Properties.svelte";
    import PaperPanel from "./PaperPanel.svelte";
    let { tab }: { tab: Extract<Tab, { type: "page" }> } = $props();
    let dock = $state<HTMLDivElement>();
    const current = untrack(() => session(tab.id, tab.pageId));
    const page = $derived(current.state.page);
    const syncing = $derived(readingTabs.has(tab.id));
    let showProperties = $state(false);
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