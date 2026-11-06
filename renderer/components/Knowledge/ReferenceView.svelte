<div class="reference-card" class:synced={config.mode === "sync"}>
    <header><span class="badge">{config.mode === "sync" ? config.writable ? "可写同步" : "只读同步" : "引用"}</span><button class="reference-title" onclick={() => page && openPage(page)}>{page?.title ?? "正在读取页面…"}</button>{#if page && !page.deleted}<button class="unlink" onclick={unlink}>解除链接并保留副本</button>{/if}</header>
    {#if error}<p class="notice error">{error}</p>{:else if page?.deleted}<p>目标已在回收站。打开目标后可恢复。</p>{:else if circular}<p>这里保留目标入口，避免链接反复展开。</p>{:else if page}
        {#if config.blockId && !block}<p>目标内容块已被删除，周围内容已保留。</p>{:else if config.mode === "sync"}<Editor readonly={!config.writable} pageId={page.id} blockId={config.blockId ?? undefined} ancestors={[...config.ancestors, page.id]} compact />{:else}<div class="reference-preview">{documentText(block ?? page.document) || "这个页面还没有正文。"}</div>{/if}
    {/if}
</div>


<style>
    .reference-card { margin: 12px 0; padding: 16px; border: 1px solid var(--c-tab-header-border); border-left: 4px solid var(--c-gold); border-radius: 10px; background: var(--c-cream); font-family: inherit; }
    .reference-card.synced { border-left-color: #a6b990; }
    header { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .reference-title { flex: 1; text-align: left; font-size: 13px; font-weight: 800; }
    .reference-title:hover { color: var(--c-accent); text-decoration: underline; }
    .unlink { color: var(--c-muted); font-size: 10px; text-decoration: underline; }
    .reference-preview { max-height: 280px; margin-top: 13px; overflow: auto; white-space: pre-wrap; user-select: text; font-size: var(--reading-font-size, 16px); line-height: 1.8; }
    p { color: var(--c-muted); font-size: 12px; line-height: 1.8; }
</style>


<script lang="ts">
    import { untrack } from "svelte";
    import type { RichDocument } from "../../../shared/types/knowledge";
    import { documentText } from "../../../shared/utils/document";
    import Editor from "../Editor/Editor.svelte";
    import { openPage } from "../layout/navigation";
    import { knowledgeState, loadPage, sessions } from "./state.svelte";

    let { config, onunlink }: { config: { targetId: string; blockId: string | null; mode: "reference" | "sync"; writable: boolean; ancestors: string[] }; onunlink: (document: RichDocument) => void } = $props();
    const page = $derived(sessions[config.targetId]?.page);
    const error = $derived(sessions[config.targetId]?.error);
    const block = $derived(page?.document.content.find(node => node.attrs?.uid === config.blockId));
    const circular = $derived(config.ancestors.includes(config.targetId) || config.ancestors.length >= 3);
    $effect(() => { const id = config.targetId; knowledgeState.version; untrack(() => { void loadPage(id, true); }); });
    function unlink(): void {
        if (!page || (config.blockId && !block)) return;
        const document: RichDocument = { type: "doc", content: structuredClone($state.snapshot(block ? [block] : page.document.content)) };
        const removeIds = (node: RichDocument["content"][number]): void => { if (node.attrs) delete node.attrs.uid; node.content?.forEach(removeIds); };
        document.content.forEach(removeIds);
        onunlink(document);
    }
</script>