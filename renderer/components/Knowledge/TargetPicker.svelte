<div class="picker paper-card" popover="auto" role="dialog" aria-label="选择引用目标" ontoggle={event => {
    if (event.newState === "closed") onclose();
}} {@attach element => {
    element.showPopover();
    element.querySelector("input")?.focus();
}}>
    <header>
        <strong>选择{mode === "sync" ? "同步块" : "引用目标"}</strong>
        <button class="text-button" onclick={onclose}>关闭</button>
    </header>
    <input type="search" placeholder="搜索页面…" bind:value={keyword} />
    {#if error}
        <p class="error">{message(error)}</p>
    {/if}
    {#if chosen}
        <button class="text-button" onclick={() => chosen = null}>← 返回页面列表</button>
        <div class="results">
            {#each orderedBlocks as { block, key, depth } (key)}
                <button style:padding-left={4 + depth * 16 + "px"} onclick={() => onselect({ kind: "block", id: block.id }, label(block))}>{label(block)}<small>{blockKindNames[block.type]}</small></button>
            {/each}
        </div>
    {:else}
        <div class="results">
            {#each pages as page (page.id)}
                <div class="result">
                    <button onclick={() => mode === "sync" ? choose(page.id) : onselect({ kind: "page", id: page.id }, page.title || "未命名")}>{page.title || "未命名"}</button>
                    <button class="text-button" onclick={() => choose(page.id)}>选择其中的块</button>
                </div>
            {:else}
                <p>没有找到页面</p>
            {/each}
        </div>
    {/if}
</div>
<style>
    .picker { position: fixed; inset: 0; margin: auto; padding: 18px; width: min(600px, calc(100vw - 48px)); max-height: calc(100vh - 72px); overflow: auto; font-family: inherit; font-size: 13px; font-weight: 400; line-height: 1.5; color: var(--c-ink); }
    header, .result { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    input { width: 100%; margin: 12px 0; padding: 10px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); }
    .results { max-height: 300px; overflow: auto; }
    .results button { display: flex; flex: 1; justify-content: space-between; padding: 10px 4px; text-align: left; overflow-wrap: anywhere; }
    .results button:hover { background: var(--c-sage); }
    small { margin-left: 12px; color: var(--c-muted); }
</style>
<script lang="ts">
    import { failure, message, type ErrorValue } from "../../i18n.svelte";
    import { type ContentBlock, type PageSummary, type PageRecord, type Target } from "../../../shared/types/content";
    import { blockText } from "../../../shared/content/blocks";
    import { blockKindNames } from "../../../shared/content/block-labels";
    import { knowledgeState } from "./state.svelte";
    let { mode = "reference", onselect, onclose }: { mode?: "reference" | "sync"; onselect: (target: Target, label: string) => void; onclose: () => void } = $props();
    let keyword = $state(""), error = $state<ErrorValue>("");
    let pages = $state<PageSummary[]>([]), chosen = $state.raw<PageRecord | null>(null);
    let referenceLabels = $state<Record<string, string>>({});
    const orderedBlocks = $derived.by(() => {
        const page = chosen, rows: { block: ContentBlock; key: string; depth: number }[] = [];
        function visit(ids: string[], path: string[], parentKey: string, depth: number): void {
            ids.forEach((id, index) => {
                const block = page?.blocks[id];
                if (!block || path.includes(id)) return;
                const next = [...path, id], key = `${parentKey}/${index}:${id}`;
                rows.push({ block, key, depth });
                visit(block.children, next, key, depth + 1);
            });
        }
        visit(page?.children ?? [], [], "", 0);
        return rows;
    });
    function label(block: ContentBlock): string {
        if (block.type === "blocked_reference") return referenceLabels[block.id] || "引用目标缺失";
        return blockText(block) || "空块";
    }
    $effect(() => {
        void knowledgeState.change.seq;
        const query = keyword;
        let active = true;
        const timer = setTimeout(() => {
            void window.api.knowledge.list({ keyword: query, limit: 50 }).then(result => {
                if (active) pages = result.items;
            }, problem => {
                if (active) error = failure(problem);
            });
        }, 150);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    });
    async function choose(id: string): Promise<void> {
        try {
            const page = await window.api.knowledge.get(id);
            chosen = page;
            referenceLabels = {};
            error = "";
            const labels = await Promise.all(Object.values(page.blocks).filter(block => block.type === "blocked_reference" && block.payload.target).map(async block => {
                try {
                    const resolved = await window.api.knowledge.resolve(block.payload.target!);
                    return [block.id, resolved ? resolved.title || "未命名目标" : "引用目标缺失"];
                }
                catch {
                    return [block.id, "引用目标缺失"];
                }
            }));
            if (chosen === page) referenceLabels = Object.fromEntries(labels);
        }
        catch (problem) {
            error = failure(problem);
        }
    }
</script>