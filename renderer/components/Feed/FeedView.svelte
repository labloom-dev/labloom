<section class="feed">
    <header>
        <h2>订阅</h2>
        <button disabled={pending || !state.sources.length} onclick={() => run(() => api.refresh())}>刷新全部</button>
        <button disabled={pending} onclick={() => {
            editing = undefined; showForm = true;
        }}>添加来源</button>
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
                {#each state.sources as item (item.id)}
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
            <p>{source.lastRefreshed ? `上次成功刷新：${formatDate(source.lastRefreshed)}，新增 ${source.lastAdded} 条` : "尚未成功刷新"}</p>
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
    {#each state.sources.filter(item => item.error && (!sourceId || item.id === sourceId)) as item (item.id)}
        <p class="error" role="alert">
            {item.name}：{item.error}
            <button disabled={pending} onclick={() => run(() => api.refresh(item.id))}>重试</button>
        </p>
    {/each}

    <p class="status" role="status">{pending ? "正在处理，请稍候…" : `共 ${state.total} 条内容。手动刷新获取更新。`}</p>
    <div class="content">
        <div class="list">
            {#each state.items as item (item.id)}
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
                <p class="empty">{!state.sources.length ? "添加论文或博客的订阅来源，开始获取更新。" : "没有匹配的内容，可刷新来源或调整筛选条件。"}</p>
            {/each}
            {#if state.total > 50}
                <div class="pagination">
                    <button disabled={pending || offset === 0} onclick={() => page(-50)}>上一页</button>
                    <span>{offset + 1}–{Math.min(offset + 50, state.total)} / {state.total}</span>
                    <button disabled={pending || offset + 50 >= state.total} onclick={() => page(50)}>下一页</button>
                </div>
            {/if}
        </div>
        <article>
            {#if selected}
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
                <p class="summary">{selected.summary || "来源未提供摘要。"}</p>
                <p class="meta">以上为来源提供的摘要或内容。{selected.url ? "完整内容请打开原文查看。" : "来源未提供可用的原文链接。"}</p>
            {:else}
                <p class="empty">选择一条内容，查看摘要与原文入口。</p>
            {/if}
        </article>
    </div>
</section>


<style>
    .feed {
        min-height: 100%;
        padding: 16px;
        background: var(--c-surface);
        color: var(--c-popover-text);
        font-size: 13px;
    }
    header, .actions, .pagination {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    header {
        margin-bottom: 16px;
    }
    h2 {
        flex: 1;
        margin: 0;
        font-size: 20px;
        font-weight: 600;
    }
    button, input, select {
        box-sizing: border-box;
        border: var(--border-width) solid var(--c-reader-input-border);
        border-radius: 6px;
        background: var(--c-surface);
        color: inherit;
        font: inherit;
    }
    button {
        min-height: 28px;
        padding: 0 8px;
    }
    button:hover:not(:disabled) {
        background: var(--c-surface-hover);
    }
    button:disabled, input:disabled, select:disabled {
        opacity: .4;
        cursor: default;
    }
    button:focus-visible, input:focus-visible, select:focus-visible {
        outline: var(--focus-width) solid var(--c-border-focus);
        outline-offset: var(--focus-offset);
    }
    .filters {
        display: flex;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: 12px;
        margin: 16px 0;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-width: 100%;
    }
    input, select {
        min-width: 0;
        max-width: 100%;
    }
    input[type="search"], select {
        height: 24px;
        padding-inline: 6px;
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
        min-height: 28px;
        gap: 8px;
    }
    input[type="checkbox"] {
        margin: 0;
        accent-color: var(--c-accent);
    }
    .source {
        padding: 12px;
        border: var(--border-width) solid var(--c-popover-border);
        border-radius: 6px;
        background: var(--c-reader-toolbar-background);
    }
    .source p {
        margin: 0 0 8px;
        line-height: 1.5;
    }
    .confirmation {
        margin-top: 12px;
    }
    .status, .meta, .empty {
        color: var(--c-reader-muted-text);
        line-height: 1.6;
    }
    .error {
        padding: 12px;
        border: var(--border-width) solid var(--c-reader-error-text);
        border-radius: 6px;
        color: var(--c-reader-error-text);
        overflow-wrap: anywhere;
        user-select: text;
    }
    .content {
        display: grid;
        grid-template-columns: minmax(200px, 2fr) minmax(250px, 3fr);
        border-top: var(--border-width) solid var(--c-popover-border);
    }
    .list {
        min-width: 0;
    }
    .item {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        padding: 14px 12px;
        box-sizing: border-box;
        text-align: left;
        border: none;
        border-bottom: var(--border-width) solid var(--c-search-divider);
        border-radius: 0;
        overflow-wrap: anywhere;
    }
    .item.active, .item.active:hover:not(:disabled) {
        background: var(--c-surface-focus);
    }
    .item strong {
        font-size: 14px;
        line-height: 1.5;
    }
    .meta {
        font-size: 12px;
    }
    .metadata {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
    }
    .excerpt {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        line-height: 1.6;
    }
    article {
        min-width: 0;
        padding: 16px;
        border-left: var(--border-width) solid var(--c-popover-border);
        overflow-wrap: anywhere;
        user-select: text;
    }
    h3 {
        margin: 0 0 12px;
        font-size: 18px;
        line-height: 1.5;
    }
    .summary, .authors {
        line-height: 1.8;
        white-space: pre-wrap;
    }
    .pagination {
        justify-content: space-between;
        padding: 16px 0;
    }
    @media (max-width: 760px) {
        .content {
            grid-template-columns: 1fr;
        }
        article {
            grid-row: 1;
            border-left: none;
            border-bottom: var(--border-width) solid var(--c-popover-border);
            padding: 16px 0;
        }
    }
</style>


<script lang="ts">
    import { onMount } from "svelte";
    import type { FeedAPI, FeedItem, FeedSource, FeedSourceInput, FeedState } from "../../../shared/types/feed";
    import SourceForm from "./SourceForm.svelte";

    let { api = window.api.feed }: { api?: FeedAPI; } = $props();

    let state = $state<FeedState>({ sources: [], items: [], total: 0 });
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
    const source = $derived(state.sources.find(item => item.id === sourceId));

    function formatDate(date: string | null): string {
        return date ? new Date(date).toLocaleString() : "未提供时间";
    }

    async function reload(): Promise<void> {
        state = await api.getState({ sourceId, keyword, unreadOnly, offset });
        if (offset > 0 && offset >= state.total) {
            offset = Math.max(0, Math.floor((state.total - 1) / 50) * 50);
            state = await api.getState({ sourceId, keyword, unreadOnly, offset });
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

    onMount(() => {
        void run();
    });
</script>