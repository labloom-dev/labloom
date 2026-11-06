<form class="search-input" onsubmit={event => event.preventDefault()}>
    <Icon name="search" />
    <input bind:value={query} aria-label="搜索工作区" placeholder="搜索页面、正文、属性和订阅…" autocomplete="off" spellcheck="false" />
    <kbd>Esc</kbd>
</form>
<div class="search-results">
    {#if matchingDestinations.length}
        <h3>{query.trim() ? "页面入口" : "快捷跳转"}</h3>
        {#each matchingDestinations as item (item.type)}
            <button class="result" onclick={() => { openDestination(item.type); onclose(); }}><span class="result-icon"><Icon name={item.icon} size={18} /></span><span><strong>{item.title}</strong><small>{item.description}</small></span><Icon name="arrow" size={15} /></button>
        {/each}
    {/if}
    {#if query.trim()}
        <h3>知识库 <span>{pending ? "搜索中…" : `${pageTotal} 个页面`}</span></h3>
        {#each pages as page (page.id)}<button class="result" onclick={() => { openPage(page); onclose(); }}><span class="result-icon"><Icon name={page.kind === "paper" ? "book" : "pen"} size={18} /></span><span><strong>{page.title}</strong><small>{page.tags.join("、") || page.excerpt.slice(0, 100) || "知识页面"}</small></span><Icon name="arrow" size={15} /></button>{/each}
        <h3>已保存的订阅内容 <span>{pending ? "搜索中…" : `${total} 条`}</span></h3>
        {#if error}<p class="search-message" role="alert">{error}</p>{/if}
        {#each items as item (item.id)}
            <button class="result" onclick={() => { openFeedItem(item); onclose(); }}><span class="result-icon feed"><Icon name="feed" size={18} /></span><span><strong>{item.title}</strong><small>{item.sourceName}，{item.isRead ? "已读" : "未读"}</small></span><Icon name="arrow" size={15} /></button>
        {/each}
        {#if !pending && !error && !items.length && !pages.length}<p class="search-message" role="status">没有找到匹配的内容，换一个关键词试试。</p>{/if}
        {#if total > items.length}<p class="search-message">显示前 {items.length} 条结果，可在订阅动态中继续筛选。</p>{/if}
    {:else}
        <p class="search-message">搜索页面标题、正文、自定义属性和订阅摘要。</p>
    {/if}
</div>
<footer><span><kbd>Tab</kbd> 选择结果</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>


<style>
    .search-input {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
        padding: 17px;
        border-bottom: 1px solid var(--c-line);
    }
    input {
        min-width: 0;
        flex: 1;
        border: 0;
        padding: 5px 0;
        background: transparent;
        font-size: 13px;
    }
    input:focus-visible {
        outline-offset: 6px;
    }
    input::placeholder {
        color: var(--c-muted);
    }
    .search-results {
        overflow: auto;
        padding: 8px;
    }
    h3 {
        display: flex;
        justify-content: space-between;
        margin: 10px 9px;
        color: var(--c-muted);
        font-size: 10px;
        font-weight: 600;
    }
    .result {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 11px 9px;
        border-radius: 9px;
        text-align: left;
    }
    .result:hover, .result:focus-visible {
        background: var(--c-gold-light);
    }
    .result > span:nth-child(2) {
        flex: 1;
        min-width: 0;
    }
    .result strong {
        display: block;
        font-size: 12px;
        line-height: 1.5;
        overflow-wrap: anywhere;
    }
    .result small {
        display: block;
        margin-top: 4px;
        color: var(--c-muted);
        font-size: 10px;
    }
    .result-icon {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 34px;
        height: 34px;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 9px;
        background: var(--c-cream);
    }
    .result-icon.feed {
        background: var(--c-sage);
    }
    .search-message {
        margin: 12px 9px;
        color: var(--c-muted);
        font-size: 11px;
        line-height: 1.8;
    }
    footer {
        display: flex;
        gap: 16px;
        flex-shrink: 0;
        padding: 13px 17px;
        border-top: 1px solid var(--c-line);
        background: var(--c-cream);
        color: var(--c-muted);
        font-size: 10px;
    }
</style>


<script lang="ts">
    import { onDestroy } from "svelte";
    import type { PageSummary } from "../../../shared/types/knowledge";
    import type { FeedItem } from "../../../shared/types/feed";
    import Icon from "../utils/Icon.svelte";
    import { destinations, openDestination, openPage } from "../layout/navigation";
    import { openFeedItem } from "../Feed/navigation.svelte";

    let { onclose }: { onclose: () => void } = $props();
    let query = $state("");
    let pending = $state(false);
    let error = $state("");
    let items = $state<FeedItem[]>([]);
    let total = $state(0);
    let pageTotal = $state(0);
    let pages = $state<PageSummary[]>([]);
    let requestId = 0;
    const matchingDestinations = $derived(destinations.filter(item =>
        `${item.title} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())
    ).slice(0, query.trim() ? 8 : 4));

    $effect(() => {
        const keyword = query.trim();
        const id = ++requestId;
        items = []; pages = []; pageTotal = 0;
        total = 0;
        error = "";
        pending = !!keyword;
        if (!keyword) return;
        const timer = setTimeout(async () => {
            try {
                const [result, knowledge] = await Promise.all([window.api.feed.getState({ keyword }), window.api.knowledge.list({ keyword, limit: 8 })]);
                if (id !== requestId) return;
                items = result.items.slice(0, 8);
                total = result.total; pages = knowledge.items; pageTotal = knowledge.total;
            }
            catch (cause) {
                if (id === requestId) error = cause instanceof Error ? cause.message : "搜索失败，请重试。";
            }
            finally {
                if (id === requestId) pending = false;
            }
        }, 200);
        return () => clearTimeout(timer);
    });

    onDestroy(() => { requestId++; });
</script>