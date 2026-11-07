<div class="editor content">
    {#if page}
        <div class="page-title">
            <InlineEditor placeholder="未命名" inline={page.blocks[page.titleBlockId].payload.inline} readonly={locked} history={session.state.history} onchange={title} onhistory={direction => void session.undo(direction)} oncomposition={session.composition} />
        </div>
        {#each page.children as blockId, index (index)}
            <BlockRow {session} {blockId} {index} containerId={page.id} {tabId} />
        {/each}
        <button class="add-block" disabled={locked} onclick={add}>＋ 添加块</button>
    {/if}
</div>
<style>
    .editor { width: 100%; min-width: 0; padding: 22px 30px 60px; color: var(--dc-c-fg-default); background: var(--dc-c-bg-default); }
    .page-title { font-size: 30px; font-weight: 800; margin: 0 0 24px 25px; line-height: 1.4; }
    .add-block { margin: 20px 0 0 25px; color: var(--c-muted); font-size: 13px; }
    @container (max-width: 500px) { .editor { padding-inline: 14px; } .page-title { font-size: 25px; } }
</style>
<script lang="ts">
    import { type PageSession } from "../Knowledge/state.svelte";
    import { type InlineNode } from "../../../shared/types/content";
    import { payload } from "../../../shared/content/blocks";
    import BlockRow from "./BlockRow.svelte";
    import InlineEditor from "./InlineEditor.svelte";
    let { session, tabId }: { session: PageSession; tabId: string } = $props();
    const page = $derived(session.state.page);
    const locked = $derived(session.state.loading || session.state.saving || !!page?.attributes.deleted);
    function title(inline: InlineNode[]): void {
        const block = page!.blocks[page!.titleBlockId];
        session.block({ ...block, payload: { ...block.payload, inline } });
    }
    function add(): void {
        const id = crypto.randomUUID();
        session.children(page!.id, [...page!.children, id], [{ id, type: "paragraph", payload: payload("paragraph"), children: [] }]);
    }
</script>