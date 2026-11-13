<section class="annotation-popover" popover="manual" {@attach element => element.showPopover()} role="dialog" aria-label="批注编辑器" style:left={left + "px"} style:top={top + "px"}>
    <header>
        <span>批注{#if current.state.dirty || current.state.saving}<span aria-label="未保存">●</span>{/if}</span>
        <button onclick={openInTab} disabled={closing}>在标签页中打开</button>
        <button onclick={close} disabled={closing}>关闭</button>
    </header>
    {#if current.state.error}<p class="error">保存失败：{current.state.error}</p>{/if}
    {#if current.state.page && !current.state.loading}
        <div class="body-only"><Editor session={current} {tabId} /></div>
    {:else}<p>正在读取…</p>{/if}
</section>
<style>
    .annotation-popover { position: fixed; inset: auto; margin: 0; z-index: 70; width: min(440px, calc(100vw - 24px)); max-height: min(480px, 70vh); overflow: auto; border: 1px solid var(--c-line); border-radius: 8px; background: var(--c-paper); color: var(--c-ink); box-shadow: 0 4px 18px #0003; font-size: 13px; }
    header { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--c-line); }
    header span { flex: 1; color: var(--c-muted); }
    header button { font-size: 11px; }
    .body-only :global(.editor) { min-height: var(--annotation-min-height); }
    .body-only :global(.tiptap > h1) { display: none; }
    .body-only :global(.tiptap) { min-height: var(--annotation-min-height); padding: 14px 22px 16px 36px; }
    p { margin: 12px; }
    .error { color: var(--c-reader-error-text); }
</style>
<script lang="ts">
    import { dirtyPages } from "../Tab/dirty.svelte";
    import { untrack } from "svelte";
    import Editor from "../Editor/Editor.svelte";
    import { session, knowledgeState } from "./state.svelte";
    import { openPage } from "../layout/navigation";
    let { pageId, tabId, position, onclose }: { pageId: string; tabId: string; position: { x: number; y: number }; onclose: () => void } = $props();
    const current = untrack(() => session(tabId, pageId));
    $effect(() => {
        const key = tabId + ":" + pageId;
        if (current.state.dirty || current.state.saving) dirtyPages.set(key, tabId); else dirtyPages.delete(key);
        return () => { dirtyPages.delete(key); };
    });
    $effect(() => { if (knowledgeState.change.purged?.includes(pageId)) { current.release(); onclose(); } });
    const left = $derived(Math.max(12, Math.min(position.x, window.innerWidth - 456)));
    const top = $derived(Math.max(48, Math.min(position.y + 8, window.innerHeight - 320)));
    let closing = $state(false);
    async function save(): Promise<boolean> {
        closing = true;
        const saved = await current.flush();
        closing = false;
        if (!saved) knowledgeState.error = current.state.error || "批注尚未保存，请结束输入法组字后重试。";
        return saved;
    }
    async function close(): Promise<void> {
        if (await save()) onclose();
    }
    async function openInTab(): Promise<void> {
        // Closing removes this component and clears its parent's reactive page id.
        const id = pageId;
        if (await save()) {
            onclose(); openPage(id, { currentGroup: true });
        }
    }
</script>