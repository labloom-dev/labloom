<section class="workspace-page library" bind:this={root} onkeydown={keys}>
    <header class="library-toolbar">
        <input bind:value={keyword} type="search" aria-label="搜索页面" placeholder="搜索标题、正文和属性…" />
        <select aria-label="页面类型" bind:value={kind} onchange={() => offset = 0}><option value="">全部类型</option>{#each Object.entries(kindNames) as [id, name] (id)}<option value={id}>{name}</option>{/each}</select>
        <select aria-label="排序" bind:value={sort}><option value="modified">最近修改</option><option value="created">最近创建</option><option value="title">按标题</option></select>
        <button class="button" disabled={busy} onclick={() => createPage()}>新建</button>
        <button class="button" disabled={busy} onclick={importPDF}>导入 PDF</button>
        {#if view === "trash"}<button class="button" disabled={busy || !result.total} onclick={() => permanent(true)}>清空回收站</button>{/if}
    </header>
    <div class="view-tabs">{#each views as item (item.id)}<button class:active={view === item.id} onclick={() => {
        view = item.id; offset = 0; selected = [];
    }}>{item.label}</button>{/each}</div>
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
            }}>{definitions.find(item => item.id === id)?.metadata.name}：{attributeText(id, value)} ×</button>
        {/each}
    </details>
    {#if error}<div class="notice error">{error}<button onclick={() => retry++}>重试</button></div>{/if}
    {#if info}<p class="info">{info}</p>{/if}
    <div class="list-toolbar"><span>{pending ? "正在读取…" : `${result.total} 个页面`}</span><div class="actions">
        {#if selected.length}<button class="button" disabled={busy} onclick={bulk}>{view === "trash" ? "恢复所选" : "移入回收站"}（{selected.length}）</button>{#if view === "trash"}<button class="button" disabled={busy} onclick={() => permanent()}>永久删除（{selected.length}）</button>{/if}{/if}
    </div></div>
    <div class="page-list" role="grid" aria-label={view === "trash" ? "回收站" : "页面列表"} aria-multiselectable="true" tabindex="0">
        {#each result.items as page (page.id)}
            <ContextActions items={pageMenu(page, tabId, selected.includes(page.id) ? selected : [page.id])}>
                <div class="page-row" id={`library-${tabId}-${page.id}`} class:selected={selected.includes(page.id)} role="row" aria-selected={selected.includes(page.id)} tabindex="0" onclick={event => choose(page, event)} onkeydown={() => {}} ondblclick={event => openPage(page.id, { otherGroup: event.ctrlKey })} oncontextmenu={() => {
                    if (!selected.includes(page.id)) {
                        selected = [page.id]; anchor = page.id;
                    }
                }}>
                    <Icon name={kindIcons[page.kind]} size={16} /><strong role="gridcell">{page.title || "未命名"}</strong><span class="excerpt" role="gridcell">{page.excerpt}</span>
                    <span class="page-tags" role="gridcell">{#each Array.isArray(page.attributes.tags) ? page.attributes.tags : [] as id (id)}<b>{attributeText("tags", [id])}</b>{/each}</span>
                    <small class="updated" role="gridcell">{attributeText("modified_at", page.attributes.modified_at)}</small>
                </div>
            </ContextActions>
        {:else}<p class="empty-list">{pending ? "正在读取…" : view === "trash" ? "回收站为空" : "没有页面"}</p>{/each}
    </div>
    {#if result.total > 40}<div class="pagination"><button class="button" disabled={pending || offset === 0} onclick={() => offset -= 40}>上一页</button><span>{offset + 1}–{Math.min(offset + 40, result.total)} / {result.total}</span><button class="button" disabled={pending || offset + 40 >= result.total} onclick={() => offset += 40}>下一页</button></div>{/if}
</section>
<style>
    .library { max-width: none; padding: 8px; background: var(--c-paper); }
    .library-toolbar { display: flex; align-items: center; gap: 6px; height: var(--library-toolbar-height); }
    input:not([type="checkbox"]), select { min-width: 0; height: var(--button-height); padding-inline: 6px; border: var(--border-width) solid var(--c-line); border-radius: var(--control-radius); background: var(--c-paper); color: inherit; font-size: var(--font-secondary); }
    .library-toolbar input { flex: 1; }
    .view-tabs { display: flex; gap: 0; margin-block: 4px; }
    .view-tabs button { height: var(--button-height); padding-inline: 10px; border: var(--border-width) solid var(--c-line); font-size: var(--font-secondary); }
    .view-tabs button.active { background: var(--c-gold-light); }
    .tag-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 17px 0; color: var(--c-muted); font-size: var(--font-min); }
    .tag-filters button, .filter-chip { padding: 5px 9px; border: var(--border-width) solid var(--c-tab-header-border); border-radius: 7px; background: var(--c-paper); }
    .tag-filters button.active { color: var(--c-ink); background: var(--c-sage); border-color: var(--c-ink); }
    .property-filters { font-size: var(--font-secondary); }
    .property-filters summary { cursor: pointer; margin: 12px 0; }
    .property-filters > * { margin-bottom: 10px; }
    .list-toolbar, .actions, .pagination { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: var(--font-secondary); }
    .list-toolbar { min-height: var(--library-toolbar-height); color: var(--c-muted); }
    .page-row { display: flex; align-items: center; gap: 8px; height: var(--library-row-height); border-bottom: var(--border-width) solid var(--c-line); padding-inline: 6px; outline-offset: -2px; }
    .page-row:hover { background: var(--c-cream); }
    .page-row.selected { background: var(--c-sage); }
    .page-row strong { min-width: 90px; max-width: 36%; font-size: var(--font-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .excerpt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-muted); font-size: var(--font-secondary); }
    .page-tags { display: flex; gap: 3px; max-width: 20%; overflow: hidden; }
    .page-tags b { font-size: var(--font-min); font-weight: 400; white-space: nowrap; padding-inline: 3px; background: var(--c-cream); border-radius: var(--control-radius); }
    .updated { color: var(--c-muted); font-size: var(--font-min); white-space: nowrap; }
    .pagination { margin-top: 8px; }
    .empty-list, .info { color: var(--c-muted); font-size: var(--font-secondary); }
    @container (max-width: 500px) { .updated, .page-tags { display: none; } }
</style>
<script lang="ts">
    import { registerEditing } from "../layout/commands";
    import { onMount, untrack } from "svelte";
    import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import { display } from "../../../shared/attrs/format";
    import { defaultValue } from "../../../shared/attrs/values";
    import { currentTimeZone } from "../layout/preferences.svelte";
    import { builtinAttrs, isBuiltin } from "../../../shared/attrs/builtins";
    import { type PageKind, type PageList, type PageQuery, type PageSummary } from "../../../shared/types/content";
    import Icon from "../utils/Icon.svelte";
    import ContextActions from "../utils/ContextActions.svelte";
    import { pageMenu } from "./page-menu";
    import { purgePages } from "./purge";
    import AttributeInput from "./AttributeInput.svelte";
    import { kindNames, kindIcons } from "./labels";
    import { createPage, openPage } from "../layout/navigation";
    import { copyData, message, confirmed, registerList, writeFromTab } from "./state.svelte";
    import { visits } from "../Tab/activity.svelte";
    let { tabId, initialView = "all" }: { tabId: string; initialView?: string } = $props();
    const views = [{ id: "all", label: "全部页面" }, { id: "papers", label: "文献" }, { id: "pinned", label: "已固定" }, { id: "trash", label: "回收站" }];
    let view = $state(untrack(() => initialView)), keyword = $state(""), applied = $state(""), kind = $state<PageKind | "">(""), sort = $state<PageQuery["sort"]>("modified"), offset = $state(0);
    let selected = $state<string[]>([]), tags = $state<string[]>([]), definitions = $state<AttributeDefinition[]>([]), result = $state<PageList>({ items: [], total: 0 });
    let root: HTMLElement;
    let retry = $state(0), anchor = $state("");
    $effect(() => {
        const value = keyword; const timer = setTimeout(() => {
            applied = value; offset = 0; selected = [];
        }, 200); return () => clearTimeout(timer);
    });
    function choose(page: PageSummary, event: MouseEvent): void {
        if (event.shiftKey && anchor) {
            const from = result.items.findIndex(item => item.id === anchor), to = result.items.findIndex(item => item.id === page.id);
            if (from >= 0) selected = result.items.slice(Math.min(from, to), Math.max(from, to) + 1).map(item => item.id);
        }
        else if (event.ctrlKey) {
            selected = selected.includes(page.id) ? selected.filter(id => id !== page.id) : [...selected, page.id]; anchor = page.id;
        }
        else {
            selected = [page.id]; anchor = page.id;
        }
    }
    function keys(event: KeyboardEvent): void {
        if (event.isComposing || (event.target instanceof Element && event.target.closest("input,textarea,select"))) return;
        if (event.ctrlKey && event.key.toLowerCase() === "a") {
            event.preventDefault(); selected = result.items.map(page => page.id);
        }
        else if (event.key === "Enter" && selected.length) {
            event.preventDefault(); for (const id of selected) openPage(id, { otherGroup: event.ctrlKey });
        }
        else if (event.key === "Delete" && selected.length && view !== "trash") {
            event.preventDefault(); void bulk();
        }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const index = result.items.findIndex(page => page.id === (selected.at(-1) ?? anchor)), next = result.items[Math.max(0, Math.min(result.items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
            if (next) {
                choose(next, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey } as MouseEvent); document.getElementById(`library-${tabId}-${next.id}`)?.focus();
            }
        }
    }
    async function permanent(all = false): Promise<void> {
        busy = true;
        try {
            if (await writeFromTab(tabId, () => purgePages(all ? null : [...selected], tabId))) selected = [];
        }
        catch (problem) {
            error = message(problem);
        }
        finally {
            busy = false;
        }
    }
    let pending = $state(false), busy = $state(false), error = $state(""), info = $state(""), filterId = $state(""), filters = $state<Record<string, AttributeValue>>({});
    const filterDefinition = $derived(definitions.find(item => item.id === filterId));
    let filterValue = $derived<AttributeValue>(filterDefinition ? defaultValue(filterDefinition.type) : null);
    const query = $derived<PageQuery>({ keyword: applied, kind: view === "papers" ? "paper" : kind, sort, offset, limit: 40, deleted: view === "trash", ...(view === "pinned" ? { pinned: true } : {}), tags: [...tags], attributes: { ...filters } });
    let definitionsDirty = false;
    onMount(() => {
        const offEditing = registerEditing(root, command => {
            if (command === "selectAll") selected = result.items.map(page => page.id);
        });
        const offList = registerList(tabId, change => {
            definitionsDirty ||= !!change.definition;
            return [
                ...(change.summaryPages ?? change.pages).filter(id => !query.kind || !change.kinds || change.kinds[id] === query.kind),
                ...(change.definition ? [change.definition] : [])
            ];
        }, load);
        return () => {
            offEditing(); offList();
        };
    });
    $effect(() => {
        void query; void retry;
        if (query.keyword) currentTimeZone();
        untrack(() => visits.refresh(tabId));
    });
    async function load(ids: string[], initial: boolean): Promise<void> {
        pending = initial;
        try {
            const changed = new Set(ids);
            // This lookup exists only until the query result is assembled.
            // eslint-disable-next-line svelte/prefer-svelte-reactivity
            const kept = new Map(result.items.filter(row => !initial && !changed.has(row.id)).map(row => [row.id, row]));
            const pages = await window.api.knowledge.listUpdates(copyData(query), [...kept.keys()]);
            for (const row of pages.items) kept.set(row.id, row);
            result = { items: pages.order.map(id => kept.get(id)!), total: pages.total };
            if (initial || definitionsDirty) {
                definitionsDirty = false;
                try {
                    definitions = await window.api.knowledge.definitions();
                }
                catch (problem) {
                    definitionsDirty = true;
                    throw problem;
                }
            }
            selected = selected.filter(id => pages.order.includes(id));
            error = "";
        }
        catch (problem) {
            error = message(problem);
            throw problem;
        }
        finally {
            pending = false;
        }
    }
    function attributeText(id: string, value: AttributeValue): string {
        const definition = definitions.find(item => item.id === id) ?? (isBuiltin(id) ? { id, ...builtinAttrs[id] } : undefined);
        return definition ? display(definition, value, { zone: currentTimeZone() }) : "";
    }
    async function importPDF(): Promise<void> {
        busy = true;
        try {
            const result = await writeFromTab(tabId, () => window.api.knowledge.importPDF(undefined, tabId));
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
            if (await writeFromTab(tabId, () => confirmed(token => view === "trash" ? window.api.knowledge.restore(ids, tabId) : window.api.knowledge.trash(ids, tabId, token)))) selected = [];
        }
        catch (problem) {
            error = message(problem);
        }
        finally {
            busy = false;
        }
    }
</script>