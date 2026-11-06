<form onsubmit={submit}>
    <h3>{source ? "编辑来源" : "添加来源"}</h3>
    <label>
        名称
        <input bind:value={name} required maxlength="200" placeholder="例如：机器学习论文" disabled={pending} />
    </label>
    <label>
        添加方式
        <select bind:value={kind} onchange={selectKind} disabled={pending}>
            <option value="url">RSS／Atom 或支持的网页地址</option>
            <option value="arxiv">arXiv 领域与关键词</option>
            {#each blogs as blog (blog.url)}
                <option value={blog.url}>{blog.name}</option>
            {/each}
        </select>
    </label>
    {#if kind === "url"}
        <label>
            订阅地址
            <input bind:value={url} type="url" required maxlength="4096" placeholder="https://rss.arxiv.org/atom/cs.LG" disabled={pending} />
        </label>
        <p class="hint">支持 RSS／Atom，以及 Anthropic 的 News、Engineering 页面。博客来源每次获取最新 10 篇，已保存的文章和阅读状态会保留。</p>
    {:else if kind === "arxiv"}
        <label>
            领域
            <input bind:value={categories} placeholder="cs.AI, cs.LG, stat.ML" disabled={pending} />
        </label>
        <label>
            关键词或短语
            <input bind:value={keyword} maxlength="200" placeholder="例如：large language model" disabled={pending} />
        </label>
        <p class="hint">多个领域用逗号分隔，匹配其中任一领域。关键词按完整短语匹配标题或摘要。</p>
        <p class="hint">仅填领域时订阅每日公告；填写关键词时获取最近提交的 10 篇匹配论文，之后刷新并累积保存。这里只获取来源返回的内容，不补齐全部历史。</p>
        {#if address.url}
            <p class="address">{address.url}</p>
        {/if}
    {:else}
        <p class="address">{address.url}</p>
        <p class="hint">每次获取最新 10 篇，已保存的文章和阅读状态会保留。</p>
    {/if}
    {#if address.error}
        <p class="hint" role="status">{address.error}</p>
    {/if}
    {#if source && address.url && address.url !== source.url}
        <p class="hint">修改地址会保留此来源已保存的条目。</p>
    {/if}
    <div class="actions">
        <button type="submit" disabled={pending || !address.url}>{pending ? "正在处理…" : "保存并校验来源"}</button>
        <button type="button" disabled={pending} onclick={oncancel}>取消</button>
    </div>
</form>


<style>
    form {
        padding: 16px;
        border: var(--border-width) solid var(--c-popover-border);
        border-radius: 6px;
        background: var(--c-surface);
    }
    h3 {
        margin: 0 0 12px;
        font-size: 15px;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
        font-size: 13px;
    }
    input, select {
        width: 100%;
        min-width: 0;
        height: 24px;
        padding-inline: 6px;
        border: var(--border-width) solid var(--c-reader-input-border);
        border-radius: 6px;
        background: var(--c-surface);
        color: inherit;
        font: inherit;
    }
    .hint, .address {
        margin: 8px 0;
        color: var(--c-reader-muted-text);
        font-size: 12px;
        line-height: 1.6;
    }
    .address {
        overflow-wrap: anywhere;
        user-select: text;
    }
    input::placeholder {
        color: var(--c-search-placeholder);
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
    }
    button {
        box-sizing: border-box;
        min-height: 28px;
        padding: 0 8px;
        border: var(--border-width) solid var(--c-reader-input-border);
        border-radius: 6px;
        background: var(--c-surface);
        color: inherit;
        font: inherit;
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
</style>


<script lang="ts">
    import { untrack } from "svelte";
    import type { FeedSource, FeedSourceInput } from "../../../shared/types/feed";
    import { arxivURL, feedURL } from "../../../shared/utils/feed";

    let { source, pending, onsave, oncancel }: {
        source?: FeedSource;
        pending: boolean;
        onsave: (input: FeedSourceInput) => Promise<void>;
        oncancel: () => void;
    } = $props();

    const blogs = [
        { name: "OpenAI News", url: "https://openai.com/news/rss.xml" },
        { name: "Anthropic News", url: "https://www.anthropic.com/news" },
        { name: "Anthropic Engineering", url: "https://www.anthropic.com/engineering" }
    ];
    let name = $state(untrack(() => source?.name ?? ""));
    let url = $state(untrack(() => source?.url ?? ""));
    let kind = $state(untrack(() => blogs.find(blog => blog.url === source?.url)?.url ?? "url"));
    let categories = $state("");
    let keyword = $state("");
    const address = $derived.by(() => {
        try {
            return { url: kind === "arxiv" ? arxivURL(categories, keyword) : feedURL(kind === "url" ? url : kind), error: "" };
        }
        catch (error) {
            return { url: "", error: error instanceof Error ? error.message : "请检查订阅条件。" };
        }
    });

    function selectKind(event: Event): void {
        const blog = blogs.find(blog => blog.url === (event.currentTarget as HTMLSelectElement).value);
        if (blog && (!name.trim() || blogs.some(blog => blog.name === name))) name = blog.name;
    }

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!pending && address.url) await onsave({ id: source?.id, name, url: address.url });
    }
</script>