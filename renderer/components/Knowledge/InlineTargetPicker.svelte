<div class="inline-picker compact-menu" popover="auto" style:left={left + "px"} style:top={top + "px"} ontoggle={event => {
    if (event.newState === "closed") onclose();
}} {@attach element => {
 element.showPopover(); element.querySelector("input")?.focus();
}}>
    <input aria-label="搜索引用目标" placeholder="搜索页面…" bind:value={keyword} onkeydown={keys} />
    {#if chosen}<button class="compact-item" onclick={() => {
        chosen = null; active = 0;
    }}>← {chosen.title}</button>{/if}
    <div class="results">
        {#each rows as row, index (row.key)}<button class="compact-item" class:active={index === active} onclick={() => choose(index)}>{row.label}<small>{row.kind}</small></button>{/each}
        {#if !rows.length}<p>没有找到页面</p>{/if}
    </div>
    {#if error}<p class="error">{message(error)}</p>{/if}
</div>
<style>
    .inline-picker { position: fixed; inset: auto; margin: 0; width: min(320px, calc(100vw - 16px)); }
    input { width: 100%; height: var(--button-height); border: var(--border-width) solid var(--c-line); background: var(--c-paper); color: inherit; font: inherit; padding-inline: 6px; }
    .results { max-height: 220px; overflow: auto; }
    .compact-item { width: 100%; overflow: hidden; text-overflow: ellipsis; }
    .compact-item.active { background: var(--c-sage); }
    small { color: var(--c-muted); font-size: var(--font-min); }
    p { color: var(--c-muted); font-size: var(--font-secondary); }
</style>
<script lang="ts">
    import { failure, message, type ErrorValue } from "../../i18n.svelte";
    import type { PageSummary, PageRecord, Target } from "../../../shared/types/content";
    import { blockText } from "../../../shared/content/blocks";
    import { blockKindNames } from "../../../shared/content/block-labels";

    let { position, bounds, onselect, onclose }: { position: { x: number; y: number }; bounds: { left: number; right: number; bottom: number }; onselect: (target: Target, label: string) => void; onclose: () => void } = $props();
    let keyword = $state(""), active = $state(0), pages = $state<PageSummary[]>([]), chosen = $state.raw<PageRecord | null>(null), error = $state<ErrorValue>("");
    const left = $derived(Math.max(bounds.left, Math.min(position.x, bounds.right - 320))), top = $derived(Math.max(40, Math.min(position.y + 6, bounds.bottom - 280)));
    const rows = $derived.by(() => {
        if (!chosen) return pages.map(page => ({ key: page.id, target: { kind: "page" as const, id: page.id }, label: page.title || "未命名", kind: "" }));
        const result: { key: string; target: Target; label: string; kind: string }[] = [];
        const visit = (ids: string[], path: string[], prefix: string): void => ids.forEach((id, index) => {
            const block = chosen?.blocks[id];
            if (!block || path.includes(id)) return;
            const key = prefix + "/" + index;
            result.push({ key, target: { kind: "block", id }, label: blockText(block) || (block.type === "blocked_reference" ? "链接引用" : blockKindNames[block.type]), kind: blockKindNames[block.type] });
            visit(block.children, [...path, id], key);
        });
        visit(chosen.children, [], ""); return result;
    });
    $effect(() => {
        const query = keyword; let live = true; active = 0; chosen = null;
        const timer = setTimeout(() => {
            void window.api.knowledge.list({ keyword: query, limit: 40 }).then(result => {
                if (live) pages = result.items;
            }, problem => {
                if (live) error = failure(problem);
            });
        }, 150);
        return () => {
            live = false; clearTimeout(timer);
        };
    });
    function choose(index: number): void {
        const row = rows[index]; if (row) onselect(row.target, row.label);
    }
    async function enter(): Promise<void> {
        const page = pages[active];
        if (!page || chosen) return;
        try {
            chosen = await window.api.knowledge.get(page.id); active = 0;
        }
        catch (problem) {
            error = failure(problem);
        }
    }
    function keys(event: KeyboardEvent): void {
        if (event.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); active = Math.max(0, Math.min(rows.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
        }
        else if (event.key === "Enter") {
            event.preventDefault(); choose(active);
        }
        else if (event.key === "ArrowRight" && !chosen) {
            event.preventDefault(); void enter();
        }
        else if (event.key === "ArrowLeft" && chosen) {
            event.preventDefault(); chosen = null; active = 0;
        }
        else if (event.key === "Escape") {
            event.preventDefault(); onclose();
        }
    }
</script>