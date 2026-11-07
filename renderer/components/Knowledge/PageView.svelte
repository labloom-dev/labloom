<section class="page-view">
    <header class="page-toolbar">
        <div class="save-state" class:failed={!!current.state.error}>{current.state.loading ? "正在读取…" : current.state.saving ? "正在保存…" : current.state.dirty ? "未保存" : "已保存"}</div>
        <button disabled={current.state.saving || !current.state.history.canUndo} onclick={() => current.undo("undo")}>撤销</button>
        <button disabled={current.state.saving || !current.state.history.redo.length} onclick={() => current.undo("redo")}>重做</button>
        {#if current.state.history.redo.length > 1}
            <select value="" onchange={event => void current.undo("redo", event.currentTarget.value)}>
                <option value="">选择重做分支</option>
                {#each current.state.history.redo as branch (branch.id)}
                    <option value={branch.id}>{new Date(branch.time).toLocaleString()}</option>
                {/each}
            </select>
        {/if}
        <div class="spacer"></div>
        <button onclick={() => openPage(tab.pageId, { duplicate: true })}>另开标签页</button>
        <button class:active={showProperties} onclick={() => showProperties = !showProperties}>属性</button>
        {#if page}
            <button disabled={current.state.saving} onclick={trash}>{page.attributes.deleted ? "恢复页面" : "移入回收站"}</button>
        {/if}
    </header>
    {#if current.state.error}
        <div class="notice error">{current.state.error}<div class="error-actions">
            <button class="button" onclick={() => current.save()}>重试保存</button>
            <button class="button" onclick={() => current.state.dirty ? current.discard() : current.refresh()}>{current.state.dirty ? "放弃输入并重读" : "重新读取"}</button>
        </div></div>
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
                <Editor session={current} tabId={tab.id} />
                <section class="backlinks">
                    <h3>引用此页</h3>
                    {#each backlinks as link (link.sourceId)}
                        <button onclick={() => openPage(link.sourceId)}>{link.title}{link.deleted ? "（已回收）" : ""}</button>
                    {:else}
                        <p>还没有其他页面引用此页。</p>
                    {/each}
                </section>
            </div>
            {#if showProperties}
                <aside>
                    <Properties session={current} {definitions} />
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
    .spacer { flex: 1; }
    .save-state { color: var(--c-muted); }
    .failed { color: var(--c-reader-error-text); }
    .page-body { display: flex; min-width: 0; flex: 1; }
    .main-content { min-width: 0; flex: 1; }
    aside { width: 310px; flex-shrink: 0; border-left: 1px solid var(--c-line); }
    .notice { margin: 14px; }
    .error-actions { display: flex; gap: 10px; margin-top: 10px; }
    .recycled, .origin { padding: 12px 26px; color: var(--c-muted); font-size: 12px; background: var(--c-cream); }
    .backlinks { padding: 20px 40px 40px; border-top: 1px dashed var(--c-line); font-size: 12px; }
    h3 { font-size: 13px; }
    .backlinks button { display: block; margin: 8px 0; text-align: left; }
    .backlinks p { color: var(--c-muted); }
    @container (max-width: 850px) { .page-body { flex-direction: column; } aside { width: 100%; border-left: 0; border-top: 1px solid var(--c-line); } }
</style>
<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { type Tab } from "../Tab/defs";
    import { type AttributeDefinition } from "../../../shared/types/attributes";
    import { type Backlink } from "../../../shared/types/content";
    import { blockText } from "../../../shared/content/blocks";
    import { session, knowledgeState, message, mutate, perform } from "./state.svelte";
    import { openPage } from "../layout/navigation";
    import { updateTab } from "../Tab/api";
    import Editor from "../Editor/Editor.svelte";
    import Properties from "./Properties.svelte";
    let { tab }: { tab: Extract<Tab, { type: "page" }> } = $props();
    const current = untrack(() => session(tab.id, tab.pageId));
    const page = $derived(current.state.page);
    let showProperties = $state(false), definitions = $state<AttributeDefinition[]>([]), backlinks = $state<Backlink[]>([]);
    onMount(() => {
        void current.refresh();
        return () => {
            void current.save().then(ok => {
                if (!ok) knowledgeState.error = "有页面未保存，输入已保留在原标签页。";
            });
        };
    });
    $effect(() => {
        void knowledgeState.revision;
        let active = true;
        void Promise.all([window.api.knowledge.definitions(), window.api.knowledge.backlinks(tab.pageId)]).then(([defs, links]) => {
            if (active) {
                definitions = defs;
                backlinks = links;
            }
        }, error => {
            if (active) current.state.error = message(error);
        });
        untrack(() => {
            if (!current.state.loading && !current.state.saving && !current.state.dirty) void current.refresh();
        });
        return () => {
            active = false;
        };
    });
    $effect(() => {
        if (page) {
            const title = blockText(page.blocks[page.titleBlockId]) || "未命名";
            untrack(() => {
                if (tab.title !== title) updateTab({ ...tab, title });
            });
        }
    });
    function trash(): void {
        void perform(async () => {
            if (await current.save() && await mutate({ type: page!.attributes.deleted ? "restore" : "trash", ids: [tab.pageId], tabId: tab.id })) await current.refresh();
        });
    }
</script>