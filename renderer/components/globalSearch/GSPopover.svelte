<div class="search-input">
    <span class="search-icon">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html search}
    </span>
    <input placeholder="搜索页面标题、正文和属性…" autocomplete="off" spellcheck="false" bind:value={keyword} onkeydown={onkeydown} />
</div>
<div class="search-results">
    {#if error}<p class="error">{error}</p>{:else if pending}<p>正在搜索…</p>{:else}{#each pages as page, index (page.id)}<button class:active={index === selected} onclick={() => choose(page.id)}><strong>{page.title || "未命名"}</strong><span>{page.excerpt || "还没有正文"}</span></button>{:else}<p>{keyword.trim() ? "没有找到匹配的页面" : "输入关键词，搜索知识库"}</p>{/each}{/if}
</div>
<footer>
    <span><kbd>Esc</kbd> 关闭</span>
</footer>


<style>
    .search-results { overflow-y: auto; max-height: 360px; }
    .search-results button { display: flex; flex-direction: column; gap: 7px; padding: 14px 18px; text-align: left; width: 100%; }
    .search-results button:hover, .search-results .active { background: var(--c-sage); }
    .search-results span { font-size: 11px; color: var(--c-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .search-results p { padding: 12px 18px; font-size: 12px; color: var(--c-muted); }
    .search-input {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
        padding: 14px 16px;
        border-bottom: 1px solid var(--c-search-divider);
    }
    .search-input:focus-within {
        border-bottom-color: var(--c-accent);
    }
    .search-icon {
        display: flex;
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        color: var(--c-search-icon);
    }
    input {
        flex: 1;
        min-width: 0;
        padding: 4px 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 15px;
        user-select: text;
    }
    input::placeholder {
        color: var(--c-search-placeholder);
    }
    footer {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        flex-shrink: 0;
        padding: 10px 16px;
        background-color: var(--c-search-footer-background);
        color: var(--c-search-secondary-text);
        font-size: 12px;
    }
</style>


<script lang="ts">
    import search from "../../assets/carbon--search.svg?raw";
    import { type PageSummary } from "../../../shared/types/content";
    import { openPage } from "../layout/navigation";
    import { currentTimeZone } from "../layout/preferences.svelte";
    import { message } from "../Knowledge/state.svelte";
    let { onclose }: { onclose: () => void } = $props();
    let keyword = $state(""), pending = $state(false), error = $state(""), selected = $state(0), pages = $state<PageSummary[]>([]);
    $effect(() => {
        currentTimeZone();
        const query = keyword.trim(); let active = true; selected = 0; pending = !!query; const timer = setTimeout(() => {
            if (!query) {
                pages = []; return;
            } void window.api.knowledge.list({ keyword: query, limit: 30 }).then(result => {
                if (active) {
                    pages = result.items; pending = false; error = "";
                }
            }, problem => {
                if (active) {
                    error = message(problem); pending = false;
                }
            });
        }, 180); return () => {
            active = false; clearTimeout(timer);
        };
    });
    function choose(id: string): void {
        openPage(id); onclose();
    }
    function onkeydown(event: KeyboardEvent): void {
        if (event.key === "ArrowDown") {
            event.preventDefault(); selected = Math.min(selected + 1, pages.length - 1);
        }
        else if (event.key === "ArrowUp") {
            event.preventDefault(); selected = Math.max(0, selected - 1);
        }
        else if (event.key === "Enter" && pages[selected]) {
            event.preventDefault(); choose(pages[selected].id);
        }
    }
</script>