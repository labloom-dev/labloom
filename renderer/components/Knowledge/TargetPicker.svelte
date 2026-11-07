<div class="picker paper-card">
    <header>
        <strong>选择{mode === "sync" ? "同步块" : "引用目标"}</strong>
        <button class="text-button" onclick={onclose}>关闭</button>
    </header>
    <input type="search" placeholder="搜索页面…" bind:value={keyword} />
    {#if error}
        <p class="error">{error}</p>
    {/if}
    {#if chosen}
        <button class="text-button" onclick={() => chosen = null}>← 返回页面列表</button>
        <div class="results">
            {#each Object.values(chosen.blocks).filter(block => block.type !== "title") as block (block.id)}
                <button onclick={() => onselect({ kind: "block", id: block.id }, blockText(block) || "空块")}>{blockText(block) || "空块"}<small>{block.type}</small></button>
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
    .picker { padding: 18px; width: min(600px, 100%); }
    header, .result { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    input { width: 100%; margin: 12px 0; padding: 10px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); }
    .results { max-height: 300px; overflow: auto; }
    .results button { display: flex; flex: 1; justify-content: space-between; padding: 10px 4px; text-align: left; overflow-wrap: anywhere; }
    .results button:hover { background: var(--c-sage); }
    small { margin-left: 12px; color: var(--c-muted); }
</style>
<script lang="ts">
    import { type PageSummary, type PageRecord, type Target } from "../../../shared/types/content";
    import { blockText } from "../../../shared/content/blocks";
    import { message } from "./state.svelte";
    let { mode = "reference", onselect, onclose }: { mode?: "reference" | "sync"; onselect: (target: Target, label: string) => void; onclose: () => void } = $props();
    let keyword = $state(""), error = $state("");
    let pages = $state<PageSummary[]>([]), chosen = $state<PageRecord | null>(null);
    $effect(() => {
        const query = keyword;
        let active = true;
        const timer = setTimeout(() => {
            void window.api.knowledge.list({ keyword: query, limit: 50 }).then(result => {
                if (active) pages = result.items;
            }, problem => {
                if (active) error = message(problem);
            });
        }, 150);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    });
    async function choose(id: string): Promise<void> {
        try {
            chosen = await window.api.knowledge.get(id);
        }
        catch (problem) {
            error = message(problem);
        }
    }
</script>