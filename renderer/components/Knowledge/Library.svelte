<section class="workspace-page library">
    <header class="page-heading">
        <div>
            <span class="eyebrow">A HOME FOR EVERY IDEA</span>
            <h1>{view === "papers" ? "文献库" : "知识库"}</h1>
            <p>笔记、文献与研究计划，都保存在你的工作区。</p>
        </div>
        <div class="actions">
            <button class="button" disabled={busy} onclick={importPDF}>导入 PDF</button>
            <button class="button primary" onclick={() => createPage()}>新建笔记</button>
        </div>
    </header>
    <div class="view-tabs">
        {#each views as item (item.id)}
            <button class:active={view === item.id} onclick={() => {
                view = item.id; offset = 0; selected = [];
            }}>{item.label}</button>
        {/each}
    </div>
    <form class="paper-card filter-bar" onsubmit={event => {
        event.preventDefault(); applied = keyword; offset = 0;
    }}>
        <input bind:value={keyword} type="search" placeholder="搜索标题、正文和属性…" />
        <select bind:value={kind} onchange={() => offset = 0}>
            <option value="">全部类型</option>
            {#each Object.entries(kindNames) as [id, name] (id)}
                <option value={id}>{name}</option>
            {/each}
        </select>
        <select bind:value={sort}>
            <option value="modified">最近修改</option>
            <option value="created">最近创建</option>
            <option value="title">按标题</option>
        </select>
        <button class="button">搜索</button>
    </form>
    <div class="tag-filters">
        <span>标签</span>
        {#each definitions.find(item => item.id === "tags")?.metadata.options ?? [] as option (option.id)}
            <button class:active={tags.includes(option.id)} onclick={() => {
                tags = tags.includes(option.id) ? tags.filter(id => id !== option.id) : [...tags, option.id]; offset = 0;
            }}>{option.name}</button>
        {:else}
            <span>在共享属性中添加第一个标签</span>
        {/each}
    </div>
    <details class="property-filters">
        <summary>按属性筛选</summary>
        <select bind:value={filterId}>
            <option value="">选择属性</option>
            {#each definitions.filter(item => !item.metadata.hidden && !item.metadata.readonly && item.id !== "deleted") as item (item.id)}
                <option value={item.id}>{item.metadata.name || item.id}</option>
            {/each}
        </select>
        {#if filterDefinition}
            <AttributeInput definition={filterDefinition} value={filterValue} onchange={value => filterValue = value} />
            <button class="button" onclick={() => {
                filters = { ...filters, [filterId]: filterValue }; offset = 0;
            }}>添加条件</button>
        {/if}
        {#each Object.entries(filters) as [id, value] (id)}
            <button class="filter-chip" onclick={() => {
                const next = { ...filters }; delete next[id]; filters = next; offset = 0;
            }}>{definitions.find(item => item.id === id)?.metadata.name}：{String(value)} ×</button>
        {/each}
    </details>
    {#if error}
        <div class="notice error">{error}<button onclick={() => retry++}>重试</button></div>
    {/if}
    {#if info}
        <p class="info">{info}</p>
    {/if}
    <div class="list-toolbar">
        <label><input type="checkbox" checked={!!result.items.length && result.items.every(page => selected.includes(page.id))} onchange={event => selected = event.currentTarget.checked ? result.items.map(page => page.id) : []} />选择本页</label>
        <span>{pending ? "正在读取…" : `${result.total} 个页面`}</span>
        <div class="actions">
            {#if selected.length}
                <button class="button" disabled={busy} onclick={bulk}>{view === "trash" ? "恢复所选" : "移入回收站"}（{selected.length}）</button>
            {/if}
        </div>
    </div>
    <div class="paper-card page-list">
        {#each result.items as page (page.id)}
            <div class="page-row">
                <input type="checkbox" checked={selected.includes(page.id)} onchange={event => selected = event.currentTarget.checked ? [...selected, page.id] : selected.filter(id => id !== page.id)} />
                <button class="page-open" onclick={() => openPage(page.id)}>
                    <span class="page-icon">
                        <Icon name={kindIcons[page.kind]} />
                    </span>
                    <span class="page-copy">
                        <strong>{page.title || "未命名"}</strong>
                        <span>{page.excerpt || "还没有正文"}</span>
                        <span class="page-meta">{kindNames[page.kind]}{#each Array.isArray(page.attributes.tags) ? page.attributes.tags : [] as id (id)}
                            <b>{definitions.find(item => item.id === "tags")?.metadata.options?.find(option => option.id === id)?.name}</b>
                        {/each}{#if page.attributes.deleted}
                            <small>{page.attributes.recycle_reason === "unreachable" ? "失去保留关系" : "手动删除"}</small>
                        {/if}</span>
                    </span>
                    <small class="updated">{formatDate(page.attributes.modified_at)}</small>
                </button>
            </div>
        {:else}
            <div class="empty-state">
                <div class="empty-art">
                    <Bloom />
                </div>
                <strong>{pending ? "正在整理页面…" : "这里还有一片空白"}</strong>
                <p>试试新建笔记、导入 PDF，或调整筛选条件。</p>
            </div>
        {/each}
    </div>
    {#if result.total > 40}
        <div class="pagination">
            <button class="button" disabled={pending || offset === 0} onclick={() => offset -= 40}>上一页</button>
            <span>{offset + 1}–{Math.min(offset + 40, result.total)} / {result.total}</span>
            <button class="button" disabled={pending || offset + 40 >= result.total} onclick={() => offset += 40}>下一页</button>
        </div>
    {/if}
    <AttributeManager {definitions} />
</section>
<style>
    .actions, .list-toolbar, .pagination { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .view-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 19px; }
    .view-tabs button { padding: 9px 16px; border: 1px solid transparent; border-radius: 9px; font-size: 12px; }
    .view-tabs button.active { border-color: var(--c-ink); background: var(--c-gold-light); box-shadow: 2px 2px 0 var(--c-ink); }
    .filter-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px; box-shadow: none; border-color: var(--c-tab-header-border); }
    input:not([type="checkbox"]), select { min-width: 0; padding: 10px 12px; border: 1px solid var(--c-tab-header-border); border-radius: 8px; background: var(--c-paper); color: var(--c-ink); font-size: 12px; }
    .filter-bar input { flex: 1; min-width: 180px; }
    input[type="checkbox"] { accent-color: var(--c-accent); width: 16px; height: 16px; flex-shrink: 0; }
    .tag-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 17px 0; color: var(--c-muted); font-size: 11px; }
    .tag-filters button, .filter-chip { padding: 5px 9px; border: 1px solid var(--c-tab-header-border); border-radius: 7px; background: var(--c-paper); }
    .tag-filters button.active { color: var(--c-ink); background: var(--c-sage); border-color: var(--c-ink); }
    .list-toolbar { justify-content: space-between; margin: 20px 0 13px; color: var(--c-muted); font-size: 11px; }
    .list-toolbar label { display: flex; align-items: center; gap: 7px; }
    .page-list { padding: 0 20px; }
    .page-row { display: flex; align-items: center; gap: 13px; border-bottom: 1px dashed var(--c-line); }
    .page-row:last-child { border-bottom: 0; }
    .page-open { display: flex; align-items: center; gap: 14px; width: 100%; min-width: 0; padding: 20px 0; text-align: left; }
    .page-open:hover strong { color: var(--c-accent); }
    .page-icon { display: grid; place-items: center; width: 40px; height: 43px; flex-shrink: 0; border: 1px solid var(--c-ink); border-radius: 10px; background: var(--c-gold-light); transform: rotate(-4deg); }
    .page-copy { flex: 1; min-width: 0; }
    .page-copy strong { display: block; font-size: 14px; overflow-wrap: anywhere; }
    .page-copy > span:not(.page-meta) { display: block; margin-top: 7px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--c-muted); font-size: 11px; }
    .page-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-top: 10px; color: var(--c-muted); font-size: 10px; }
    .page-meta b { padding: 3px 6px; border-radius: 5px; background: var(--c-sage); font-weight: 500; }
    small, .updated { color: var(--c-muted); font-size: 10px; font-weight: 500; }
    .pagination { justify-content: space-between; margin-top: 20px; font-size: 12px; }
    .empty-art { width: 150px; }
    .property-filters { font-size: 12px; }
    .property-filters summary { cursor: pointer; margin: 12px 0; }
    .property-filters > * { margin-bottom: 10px; }
    .info { font-size: 12px; color: var(--c-muted); }
    @container (max-width: 550px) { .updated { display: none; } .page-icon { width: 30px; height: 34px; } .page-list { padding-inline: 12px; } }
</style>
<script lang="ts">
    import { untrack } from "svelte";
    import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import { type PageKind, type PageList, type PageQuery } from "../../../shared/types/content";
    import Icon from "../utils/Icon.svelte";
    import Bloom from "../utils/Bloom.svelte";
    import AttributeInput from "./AttributeInput.svelte";
    import AttributeManager from "./AttributeManager.svelte";
    import { kindNames, kindIcons } from "./labels";
    import { createPage, openPage } from "../layout/navigation";
    import { copyData, knowledgeState, message, confirmed, saveAll } from "./state.svelte";
    let { initialView = "all" }: { initialView?: string } = $props();
    const views = [{ id: "all", label: "全部页面" }, { id: "papers", label: "文献" }, { id: "pinned", label: "已固定" }, { id: "trash", label: "回收站" }];
    let view = $state(untrack(() => initialView)), keyword = $state(""), applied = $state(""), kind = $state<PageKind | "">(""), sort = $state<PageQuery["sort"]>("modified"), offset = $state(0);
    let selected = $state<string[]>([]), tags = $state<string[]>([]), definitions = $state<AttributeDefinition[]>([]), result = $state<PageList>({ items: [], total: 0 });
    let retry = $state(0);
    let pending = $state(false), busy = $state(false), error = $state(""), info = $state(""), filterId = $state(""), filterValue = $state<AttributeValue>(null), filters = $state<Record<string, AttributeValue>>({});
    const filterDefinition = $derived(definitions.find(item => item.id === filterId));
    $effect(() => {
        void knowledgeState.change.seq; void retry;
        const query: PageQuery = { keyword: applied, kind: view === "papers" ? "paper" : kind, sort, offset, limit: 40, deleted: view === "trash", ...(view === "pinned" ? { pinned: true } : {}), tags: [...tags], attributes: { ...filters } };
        let active = true;
        pending = true;
        void Promise.all([window.api.knowledge.list(copyData(query)), window.api.knowledge.definitions()]).then(([pages, attrs]) => {
            if (active) {
                result = pages;
                definitions = attrs;
                error = "";
                selected = selected.filter(id => pages.items.some(page => page.id === id));
                pending = false;
            }
        }, problem => {
            if (active) {
                error = message(problem);
                pending = false;
            }
        });
        return () => {
            active = false;
        };
    });
    function formatDate(value: AttributeValue): string {
        return typeof value === "number" ? new Date(value * 1000).toLocaleDateString() : "";
    }
    async function importPDF(): Promise<void> {
        busy = true;
        try {
            if (!await saveAll()) return;
            const result = await window.api.knowledge.importPDF();
            if (result) {
                info = result.reused ? "该文件已在文献库中，已打开原有文献。" : "PDF 已复制到工作区。";
                openPage(result.pageId);
            }
        }
        catch (problem) {
            error = message(problem);
        }
        finally {
            busy = false;
        }
    }
    async function bulk(): Promise<void> {
        busy = true;
        try {
            const ids = [...selected];
            if (await saveAll() && await confirmed(token => view === "trash" ? window.api.knowledge.restore(ids, "library") : window.api.knowledge.trash(ids, "library", token))) selected = [];
        }
        catch (problem) {
            error = message(problem);
        }
        finally {
            busy = false;
        }
    }
</script>