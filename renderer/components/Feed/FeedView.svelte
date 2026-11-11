<section class="feed">
    <header>
        <div class="heading-copy"><span class="eyebrow">A LETTER FROM THE WORLD</span><h1>订阅动态</h1><p>让值得阅读的论文与文章，来到你的知识花园。</p></div>
        <button disabled={pending || !feedState.sources.length} onclick={() => run(() => api.refresh())}><Icon name="refresh" size={15} />刷新全部</button>
        <button class="primary" disabled={pending} onclick={() => {
            editing = undefined; showForm = true;
        }}><Icon name="plus" size={15} />添加来源</button>
    </header>

    {#if error}
        <p class="error" role="alert">{error}</p>
        <button disabled={pending} onclick={() => run()}>重新加载</button>
    {/if}
    {#if showForm}
        {#key editing?.id}
            <SourceForm source={editing} {pending} onsave={saveSource} oncancel={() => showForm = false} />
        {/key}
    {/if}

    <form class="filters" onsubmit={filter}>
        <label>
            来源
            <select bind:value={sourceId} disabled={pending} onchange={filter}>
                <option value="">全部来源</option>
                {#each feedState.sources as item (item.id)}
                    <option value={item.id}>{item.name}（{item.unreadCount} 条未读）</option>
                {/each}
            </select>
        </label>
        <label class="search">
            标题或摘要
            <input bind:value={keyword} type="search" placeholder="筛选已获取的内容" disabled={pending} />
        </label>
        <label class="checkbox"><input type="checkbox" bind:checked={unreadOnly} disabled={pending} onchange={filter} />仅未读</label>
        <button type="submit" disabled={pending}>筛选</button>
    </form>

    {#if source}
        <div class="source">
            <p>{source.lastRefreshed !== null ? `上次成功刷新：${formatDate(source.lastRefreshed)}，新增 ${source.lastAdded} 条` : "尚未成功刷新"}</p>
            <div class="actions">
                <button disabled={pending} onclick={() => run(() => api.refresh(sourceId))}>刷新此来源</button>
                <button disabled={pending} onclick={() => {
                    editing = source; showForm = true;
                }}>编辑</button>
                <button disabled={pending} onclick={() => removing = sourceId}>取消订阅</button>
            </div>
            {#if removing === sourceId}
                <div class="confirmation">
                    <p>取消订阅将删除此来源及其已保存的条目和阅读状态。</p>
                    <button disabled={pending} onclick={removeSource}>确认取消订阅</button>
                    <button disabled={pending} onclick={() => removing = ""}>保留</button>
                </div>
            {/if}
        </div>
    {/if}
    {#each feedState.sources.filter(item => item.error && (!sourceId || item.id === sourceId)) as item (item.id)}
        <p class="error" role="alert">
            {item.name}：{item.error}
            <button disabled={pending} onclick={() => run(() => api.refresh(item.id))}>重试</button>
        </p>
    {/each}

    <p class="status" role="status">{pending ? "正在处理，请稍候…" : `共 ${feedState.total} 条内容。手动刷新获取更新。`}</p>
    <div class="content">
        <div class="list">
            {#each feedState.items as item (item.id)}
                <button class="item" class:active={selected?.id === item.id} disabled={pending} onclick={() => selectItem(item)}>
                    <span class="meta metadata">
                        <span>{item.sourceName}</span>
                        <span>{formatDate(item.publishedAt)}</span>
                        <span>{item.isRead ? "已读" : "未读"}</span>
                    </span>
                    <strong>{item.title}</strong>
                    {#if item.authors}<span class="meta">{item.authors}</span>{/if}
                    <span class="excerpt">{item.summary || "来源未提供摘要。"}</span>
                </button>
            {:else}
                <div class="empty-state"><Icon name="feed" size={30} /><strong>{!feedState.sources.length ? "还没有新知来信" : "没有匹配的内容"}</strong><p>{!feedState.sources.length ? "添加论文或博客的订阅来源，开始获取更新。" : "试试刷新来源，或调整上方的筛选条件。"}</p>{#if !feedState.sources.length}<button disabled={pending} onclick={() => {
                    editing = undefined; showForm = true;
                }}>添加来源</button>{/if}</div>
            {/each}
            {#if feedState.total > 50}
                <div class="pagination">
                    <button disabled={pending || offset === 0} onclick={() => page(-50)}>上一页</button>
                    <span>{offset + 1}–{Math.min(offset + 50, feedState.total)} / {feedState.total}</span>
                    <button disabled={pending || offset + 50 >= feedState.total} onclick={() => page(50)}>下一页</button>
                </div>
            {/if}
        </div>
        <article class:has-selection={selected !== null}>
            {#if selected}
                <span class="eyebrow">READ & DISCOVER</span>
                <h3>{selected.title}</h3>
                <p class="meta metadata">
                    <span>{selected.sourceName}</span>
                    <span>{formatDate(selected.publishedAt)}</span>
                </p>
                {#if selected.authors}<p class="authors">{selected.authors}</p>{/if}
                <div class="actions">
                    <button disabled={pending || !selected.url} onclick={openItem}>打开原文</button>
                    <button disabled={pending} onclick={toggleRead}>{selected.isRead ? "标为未读" : "标为已读"}</button>
                </div>
                <div class="actions"><button disabled={pending || selectedIndex <= 0} onclick={() => selectItem(feedState.items[selectedIndex - 1])}>上一篇</button><button disabled={pending || selectedIndex < 0 || selectedIndex >= feedState.items.length - 1} onclick={() => selectItem(feedState.items[selectedIndex + 1])}>下一篇</button></div>
                <p class="summary">{selected.summary || "来源未提供摘要。"}</p>
                <p class="meta">以上为来源提供的摘要或内容。{selected.url ? "完整内容请打开原文查看。" : "来源未提供可用的原文链接。"}</p>
            {:else}
                <div class="empty-state"><div class="empty-art"><Bloom /></div><strong>挑一封来信，慢慢读。</strong><p>选择左侧内容，在这里查看摘要，<br />或打开原文继续探索。</p></div>
            {/if}
        </article>
    </div>
</section>


<style>
    .feed {
        min-height: 100%;
        padding: clamp(20px, 3vw, 36px);
        color: var(--c-ink);
        font-size: 12px;
        container-type: inline-size;
    }
    header, .actions, .pagination {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
    }
    header {
        margin-bottom: 26px;
    }
    .heading-copy {
        flex: 1;
        min-width: 200px;
    }
    h1 {
        margin: 7px 0 9px;
        font-size: 29px;
        font-weight: 900;
    }
    .heading-copy p {
        margin: 0;
        color: var(--c-muted);
        font-size: 12px;
        line-height: 1.7;
    }
    button, input, select {
        box-sizing: border-box;
        border: 1px solid var(--c-reader-input-border);
        border-radius: 8px;
        background: var(--c-paper);
        color: inherit;
        font: inherit;
    }
    button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 35px;
        padding: 7px 12px;
        font-weight: 700;
    }
    header > button {
        border: 1.5px solid var(--c-ink);
        padding: 9px 13px;
        border-radius: 10px;
    }
    header > button.primary {
        background: var(--c-gold);
        box-shadow: 2px 3px 0 var(--c-ink);
    }
    button:hover:not(:disabled) {
        background: var(--c-gold-light);
        border-color: var(--c-ink);
    }
    button:disabled, input:disabled, select:disabled {
        opacity: .45;
        cursor: not-allowed;
    }
    .filters {
        display: flex;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: 14px;
        padding: 17px;
        margin: 22px 0 16px;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 12px;
        background: var(--c-paper);
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 7px;
        max-width: 100%;
        color: var(--c-muted);
        font-size: 10px;
        font-weight: 700;
    }
    input, select {
        min-width: 0;
        max-width: 100%;
    }
    input[type="search"], select {
        height: 35px;
        padding-inline: 10px;
        color: var(--c-ink);
        font-size: 12px;
    }
    input::placeholder {
        color: var(--c-search-placeholder);
    }
    .search {
        flex: 1;
        min-width: 160px;
    }
    .checkbox {
        flex-direction: row;
        align-items: center;
        align-self: flex-end;
        min-height: 35px;
        gap: 8px;
    }
    input[type="checkbox"] {
        margin: 0;
        accent-color: var(--c-accent);
    }
    .source {
        padding: 16px;
        border: 1px solid var(--c-popover-border);
        border-radius: 10px;
        background: var(--c-gold-light);
    }
    .source p {
        margin: 0 0 10px;
        line-height: 1.7;
    }
    .confirmation {
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px dashed var(--c-tab-header-border);
    }
    .status, .meta {
        color: var(--c-muted);
        line-height: 1.7;
    }
    .status {
        margin: 18px 2px 12px;
        font-size: 10px;
    }
    .error {
        padding: 14px;
        border: 1px solid var(--c-reader-error-text);
        border-radius: 10px;
        background: var(--c-peach);
        color: var(--c-reader-error-text);
        overflow-wrap: anywhere;
        user-select: text;
    }
    .content {
        display: grid;
        grid-template-columns: minmax(230px, 2fr) minmax(260px, 3fr);
        align-items: start;
        gap: 22px;
    }
    .list {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .item {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 9px;
        width: 100%;
        padding: 18px;
        text-align: left;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 12px;
        overflow-wrap: anywhere;
        transition: border-color .15s, box-shadow .15s;
        font-weight: 400;
    }
    .item.active, .item.active:hover:not(:disabled) {
        border: 1.5px solid var(--c-ink);
        background: var(--c-gold-light);
        box-shadow: 2px 3px 0 var(--c-ink);
    }
    .item strong {
        font-size: 14px;
        line-height: 1.6;
        font-weight: 800;
    }
    .meta {
        font-size: 10px;
    }
    .metadata {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 12px;
    }
    .metadata > span:first-child {
        color: var(--c-accent);
        font-weight: 700;
    }
    .excerpt {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        color: var(--c-muted);
        font-size: 12px;
        line-height: 1.8;
    }
    article {
        min-width: 0;
        min-height: 400px;
        padding: 26px;
        border: 1.5px solid var(--c-ink);
        border-radius: 15px;
        background: var(--c-paper);
        box-shadow: var(--c-shadow);
        overflow-wrap: anywhere;
        user-select: text;
    }
    h3 {
        margin: 12px 0 16px;
        font-size: 22px;
        font-weight: 900;
        line-height: 1.5;
    }
    article .actions {
        margin: 22px 0;
        padding-bottom: 22px;
        border-bottom: 1px dashed var(--c-line);
    }
    .summary, .authors {
        line-height: 1.9;
        white-space: pre-wrap;
    }
    .summary {
        font-size: var(--reading-font-size, 16px);
    }
    .authors {
        color: var(--c-muted);
        font-size: 12px;
    }
    .pagination {
        justify-content: space-between;
        padding: 16px 0;
    }
    .empty-state {
        min-height: 280px;
        padding-inline: 15px;
    }
    .empty-art {
        width: 150px;
        transform: rotate(-4deg);
    }
    .list > .empty-state {
        border: 1px dashed var(--c-tab-header-border);
        border-radius: 12px;
        background: var(--c-paper);
    }
    @container (max-width: 690px) {
        .content {
            grid-template-columns: 1fr;
        }
        article.has-selection {
            grid-row: 1;
        }
        article:not(.has-selection) {
            display: none;
        }
        article {
            min-height: 0;
        }
    }
</style>


<script lang="ts">
    import { displayMilliseconds } from "../layout/preferences.svelte";
    import { onMount, untrack } from "svelte";
    import type { FeedAPI, FeedItem, FeedSource, FeedSourceInput, FeedState } from "../../../shared/types/feed";
    import Icon from "../utils/Icon.svelte";
    import Bloom from "../utils/Bloom.svelte";
    import { feedNavigation } from "./navigation.svelte";
    import SourceForm from "./SourceForm.svelte";

    let { api = window.api.feed }: { api?: FeedAPI; } = $props();

    let feedState = $state<FeedState>({ sources: [], items: [], total: 0 });
    let sourceId = $state("");
    let keyword = $state("");
    let unreadOnly = $state(false);
    let offset = $state(0);
    let pending = $state(false);
    let error = $state("");
    let selected = $state<FeedItem | null>(null);
    let showForm = $state(false);
    let editing = $state<FeedSource | undefined>();
    let removing = $state("");
    const selectedIndex = $derived(feedState.items.findIndex(item => item.id === selected?.id));
    const source = $derived(feedState.sources.find(item => item.id === sourceId));

    function formatDate(date: number | null): string {
        return date !== null ? displayMilliseconds(date) : "未提供时间";
    }

    async function reload(): Promise<void> {
        feedState = await api.getState({ sourceId, keyword, unreadOnly, offset });
        if (offset > 0 && offset >= feedState.total) {
            offset = Math.max(0, Math.floor((feedState.total - 1) / 50) * 50);
            feedState = await api.getState({ sourceId, keyword, unreadOnly, offset });
        }
    }

    async function run(action?: () => Promise<unknown>): Promise<void> {
        if (pending) return;
        pending = true;
        error = "";
        try {
            await action?.();
            await reload();
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : "操作失败，请重试。";
        }
        finally {
            pending = false;
        }
    }

    async function filter(event: Event): Promise<void> {
        event.preventDefault();
        offset = 0;
        selected = null;
        removing = "";
        await run();
    }

    async function page(delta: number): Promise<void> {
        offset += delta;
        await run();
    }

    async function saveSource(input: FeedSourceInput): Promise<void> {
        await run(async () => {
            sourceId = await api.saveSource(input);
            offset = 0;
            keyword = "";
            unreadOnly = false;
            selected = null;
            showForm = false;
        });
    }

    async function removeSource(): Promise<void> {
        await run(async () => {
            await api.removeSource(sourceId);
            sourceId = "";
            removing = "";
            selected = null;
            offset = 0;
            showForm = false;
        });
    }

    async function selectItem(item: FeedItem): Promise<void> {
        await run(async () => {
            if (!item.isRead) await api.setRead(item.id, true);
            selected = { ...item, isRead: true };
        });
    }

    async function toggleRead(): Promise<void> {
        const item = selected;
        if (!item) return;
        await run(async () => {
            await api.setRead(item.id, !item.isRead);
            selected = { ...item, isRead: !item.isRead };
        });
    }

    async function openItem(): Promise<void> {
        const item = selected;
        if (item) await run(() => api.openItem(item.id));
    }

    $effect(() => {
        const item = feedNavigation.item;
        if (!item || pending) return;
        untrack(() => {
            feedNavigation.item = null;
            sourceId = "";
            keyword = "";
            unreadOnly = false;
            offset = 0;
            void selectItem(item);
        });
    });

    onMount(() => {
        void run();
    });
</script>