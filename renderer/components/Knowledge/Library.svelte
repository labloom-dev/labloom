<section class="workspace-page library">
    <header class="page-heading"><div><span class="eyebrow">A HOME FOR EVERY IDEA</span><h1>{view === "papers" ? "文献库" : "知识库"}</h1><p>笔记、文献与研究计划，都保存在你的工作区。</p></div><div class="actions"><button class="button" disabled={busy} onclick={importPDF}>导入 PDF</button><button class="button primary" onclick={() => createPage()}>新建笔记</button></div></header>
    <div class="view-tabs" aria-label="知识库视图">{#each views as item (item.id)}<button class:active={view === item.id} onclick={() => { view = item.id; offset = 0; selected = []; }}>{item.label}</button>{/each}</div>
    <form class="paper-card filter-bar" onsubmit={event => { event.preventDefault(); appliedKeyword = keyword; offset = 0; }}>
        <input bind:value={keyword} type="search" placeholder="搜索标题、正文和属性…" aria-label="搜索知识库" />
        <select bind:value={kind} onchange={() => offset = 0} aria-label="页面类型"><option value="">全部类型</option>{#each kinds as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select>
        <select bind:value={sort} aria-label="排列方式"><option value="updated">最近修改</option><option value="created">最近创建</option><option value="title">按标题</option></select>
        <button class="button" type="submit">搜索</button>
    </form>
    {#if properties.length}<details class="property-filters"><summary>按自定义属性筛选</summary><div class="inline-form"><select aria-label="筛选属性" bind:value={filterProperty}><option value="">选择属性</option>{#each properties as property}<option value={property.id}>{property.name}</option>{/each}</select><input aria-label="属性筛选值" placeholder="输入精确值，勾选属性填写 true 或 false" bind:value={filterValue} /><button class="button" disabled={!filterProperty} onclick={addFilter}>添加条件</button><button class="text-button" onclick={() => propertyFilters = {}}>清空属性条件</button></div><div class="tag-filters">{#each Object.entries(propertyFilters) as [id, value]}<button onclick={() => { const next = { ...propertyFilters }; delete next[id]; propertyFilters = next; }}>{properties.find(item => item.id === id)?.name}：{String(value)} ×</button>{/each}</div></details>{/if}
    <div class="tag-filters"><span>标签</span>{#each tags as tag (tag)}<button class:active={selectedTags.includes(tag)} onclick={() => { selectedTags = selectedTags.includes(tag) ? selectedTags.filter(value => value !== tag) : [...selectedTags, tag]; offset = 0; }}>{tag}</button>{:else}<span>在页面中添加第一个标签。</span>{/each}</div>
    {#if error}<p class="notice error" role="alert">{error} <button onclick={load}>重试</button></p>{/if}
    <div class="list-toolbar"><span>{pending ? "正在加载…" : `共 ${result.total} 个页面`}</span><div class="actions">
        <label class="select-all"><input type="checkbox" checked={!!result.items.length && result.items.every(item => selected.includes(item.id))} onchange={event => selected = event.currentTarget.checked ? result.items.map(item => item.id) : []} />选择本页</label>
        {#if selected.length}<span>已选 {selected.length} 项</span><button class="button" disabled={busy} onclick={exportPages}>导出 Markdown</button>{#if view === "trash"}<button class="button" disabled={busy} onclick={restorePages}>恢复</button>{:else}<button class="button" disabled={busy} onclick={trashPages}>移入回收站</button>{/if}{/if}
    </div></div>
    {#if selected.length && view !== "trash"}<div class="paper-card bulk-editor"><strong>批量修改所选页面</strong><div class="inline-form"><input aria-label="批量标签" bind:value={batchTag} placeholder="输入标签名称" maxlength="100" /><button class="button" disabled={busy || !batchTag.trim()} onclick={() => bulk({ addTags: [batchTag.trim()] })}>添加标签</button><button class="button" disabled={busy || !batchTag.trim()} onclick={() => bulk({ removeTags: [batchTag.trim()] })}>移除标签</button><button class="button" disabled={busy} onclick={() => bulk({ independent: true })}>独立保留</button><button class="button" disabled={busy} onclick={() => bulk({ pinned: true })}>固定</button><button class="button" disabled={busy} onclick={() => bulk({ pinned: false })}>取消固定</button></div>{#if properties.length}<div class="inline-form"><select aria-label="批量属性" bind:value={batchProperty}><option value="">选择属性</option>{#each properties as property}<option value={property.id}>{property.name}</option>{/each}</select><input aria-label="批量属性值" bind:value={batchValue} placeholder="输入新值，留空清除" /><button class="button" disabled={busy || !batchProperty} onclick={batchSetProperty}>设置属性</button></div>{/if}</div>{/if}
    <div class="paper-card page-list" aria-busy={pending}>
        {#each result.items as item (item.id)}
            <div class="page-row"><input type="checkbox" aria-label={`选择${item.title}`} checked={selected.includes(item.id)} onchange={event => selected = event.currentTarget.checked ? [...selected, item.id] : selected.filter(id => id !== item.id)} /><button class="page-open" onclick={() => openPage(item)}><span class="page-icon"><Icon name={item.kind === "paper" ? "book" : item.kind === "task" || item.kind === "event" ? "calendar" : "pen"} /></span><span class="page-copy"><strong>{item.title}{#if item.pinned}<small>已固定</small>{/if}</strong><span>{item.excerpt || "还没有正文，打开页面写下第一个想法。"}</span><span class="page-meta">{kindLabel(item.kind)}{#each item.tags.slice(0, 4) as tag (tag)}<b>{tag}</b>{/each}</span></span><span class="updated">{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span><Icon name="arrow" size={16} /></button></div>
        {:else}<div class="empty-state"><div class="empty-art"><Bloom /></div><strong>{view === "trash" ? "回收站是空的" : "给知识花园种下第一颗种子"}</strong><p>{appliedKeyword || selectedTags.length ? "试试调整关键词或标签。" : "创建一篇笔记，或导入你正在阅读的 PDF。"}</p>{#if view !== "trash"}<button class="button primary" onclick={() => createPage()}>新建笔记</button>{/if}</div>{/each}
    </div>
    {#if result.total > 40}<div class="pagination"><button class="button" disabled={pending || offset === 0} onclick={() => offset -= 40}>上一页</button><span>{offset + 1}–{Math.min(offset + 40, result.total)} / {result.total}</span><button class="button" disabled={pending || offset + 40 >= result.total} onclick={() => offset += 40}>下一页</button></div>{/if}
    <details class="paper-card management"><summary>导入文献、管理标签与属性</summary><div class="management-body">
        <div class="actions"><button class="button" disabled={busy} onclick={importBib}>导入 BibTeX</button><button class="button" disabled={busy || !selected.length || selected.some(id => result.items.find(item => item.id === id)?.kind !== "paper")} onclick={exportBib}>导出所选 BibTeX</button></div>
        <form class="inline-form" onsubmit={importDOI}><label for="doi-input">通过 DOI 导入</label><input id="doi-input" bind:value={doi} placeholder="10.1234/example" required /><button class="button" disabled={busy}>获取文献</button></form>
        <h2>共享标签</h2><p class="muted">重命名会同步到所有页面，删除标签会保留页面。</p>
        {#each tags as tag (tag)}<div class="inline-form"><input aria-label={`重命名${tag}`} value={tagNames[tag] ?? tag} oninput={event => tagNames[tag] = event.currentTarget.value} /><button class="button" disabled={busy} onclick={() => perform("正在重命名标签…", async () => { await window.api.knowledge.renameTag(tag, tagNames[tag] ?? tag); selectedTags = []; })}>重命名</button><button class="button" disabled={busy} onclick={() => { if (confirm(`删除标签“${tag}”？页面会保留。`)) void perform("正在删除标签…", async () => { await window.api.knowledge.removeTag(tag); selectedTags = selectedTags.filter(value => value !== tag); }); }}>删除</button></div>{/each}
        <h2>自定义属性</h2><form class="inline-form" onsubmit={addProperty}><input bind:value={propertyName} aria-label="新属性名称" placeholder="例如：研究方向" required maxlength="100" /><select bind:value={propertyType} aria-label="属性类型"><option value="string">文本</option><option value="number">数字</option><option value="boolean">勾选</option><option value="date">日期</option></select><button class="button" disabled={busy}>添加属性</button></form>
        {#each properties as property (property.id)}<div class="property-row"><span>{property.name} <small>{property.type}</small></span><button class="text-action" disabled={busy} onclick={() => { if (confirm(`删除属性“${property.name}”及所有页面中这个属性的值？`)) void perform("正在删除属性…", () => window.api.knowledge.removeProperty(property.id)); }}>删除属性</button></div>{/each}
    </div></details>
</section>


<style>
    .bulk-editor { margin-bottom: 16px; padding: 17px; box-shadow: none; font-size: 12px; }
    .property-filters { margin-top: 12px; font-size: 11px; }
    .property-filters summary { padding: 8px 0; }
    .actions, .list-toolbar, .pagination { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .view-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 19px; }
    .view-tabs button { padding: 9px 16px; border: 1px solid transparent; border-radius: 9px; font-size: 12px; }
    .view-tabs button.active { border-color: var(--c-ink); background: var(--c-gold-light); box-shadow: 2px 2px 0 var(--c-ink); }
    .filter-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px; box-shadow: none; border-color: var(--c-tab-header-border); }
    input:not([type="checkbox"]), select { min-width: 0; padding: 10px 12px; border: 1px solid var(--c-tab-header-border); border-radius: 8px; background: var(--c-paper); font-size: 12px; }
    .filter-bar input { flex: 1; min-width: 180px; }
    input[type="checkbox"] { accent-color: var(--c-accent); width: 16px; height: 16px; flex-shrink: 0; }
    .tag-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 17px 0; color: var(--c-muted); font-size: 11px; }
    .tag-filters button { padding: 5px 9px; border: 1px solid var(--c-tab-header-border); border-radius: 7px; background: var(--c-paper); }
    .tag-filters button.active { color: var(--c-ink); background: var(--c-sage); border-color: var(--c-ink); }
    .list-toolbar { justify-content: space-between; margin: 20px 0 13px; color: var(--c-muted); font-size: 11px; }
    .select-all { display: flex; align-items: center; gap: 7px; }
    .page-list { padding: 0 20px; }
    .page-row { display: flex; align-items: center; gap: 13px; border-bottom: 1px dashed var(--c-line); }
    .page-row:last-child { border-bottom: 0; }
    .page-open { display: flex; align-items: center; gap: 14px; width: 100%; min-width: 0; padding: 20px 0; text-align: left; }
    .page-open:hover strong { color: var(--c-accent); }
    .page-icon { display: grid; place-items: center; width: 40px; height: 43px; flex-shrink: 0; border: 1px solid var(--c-ink); border-radius: 10px; background: var(--c-gold-light); transform: rotate(-4deg); }
    .page-copy { flex: 1; min-width: 0; }
    .page-copy strong { display: flex; gap: 10px; align-items: center; font-size: 14px; overflow-wrap: anywhere; }
    .page-copy > span:not(.page-meta) { display: block; margin-top: 7px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--c-muted); font-size: 11px; }
    .page-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-top: 10px; color: var(--c-muted); font-size: 10px; }
    .page-meta b { padding: 3px 6px; border-radius: 5px; background: var(--c-sage); font-weight: 500; }
    small, .updated { color: var(--c-muted); font-size: 10px; font-weight: 500; }
    .pagination { justify-content: space-between; margin-top: 20px; font-size: 12px; }
    .empty-art { width: 150px; }
    .management { margin-top: 27px; box-shadow: none; border-color: var(--c-tab-header-border); }
    summary { padding: 18px 20px; cursor: pointer; font-size: 12px; font-weight: 700; }
    .management-body { padding: 5px 20px 20px; }
    .inline-form { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 14px; font-size: 12px; }
    .inline-form input { flex: 1; min-width: 150px; }
    h2 { margin: 25px 0 10px; font-size: 14px; }
    .muted { color: var(--c-muted); font-size: 11px; }
    .property-row { display: flex; justify-content: space-between; gap: 15px; padding-top: 14px; font-size: 12px; }
    .text-action { color: var(--c-accent); text-decoration: underline; }
    @container (max-width: 550px) { .updated { display: none; } .page-icon { width: 30px; height: 34px; } .page-list { padding-inline: 12px; } }
</style>


<script lang="ts">
    import { untrack } from "svelte";
    import type { PageChanges, ImportResult, PageKind, PageList, PageQuery, PropertyDefinition } from "../../../shared/types/knowledge";
    import Icon from "../utils/Icon.svelte";
    import Bloom from "../utils/Bloom.svelte";
    import { createPage, openPage } from "../layout/navigation";
    import { knowledgeState, perform, saveAll } from "./state.svelte";

    const views = [{ id: "all", label: "全部页面" }, { id: "papers", label: "文献" }, { id: "pinned", label: "已固定" }, { id: "trash", label: "回收站" }];
    const kinds: { value: PageKind; label: string }[] = [{ value: "editable", label: "笔记" }, { value: "paper", label: "文献" }, { value: "task", label: "任务" }, { value: "event", label: "日程" }, { value: "annotation", label: "批注" }];
    let { initialView = "all" }: { initialView?: string } = $props();
    let view = $state(untrack(() => initialView));
    let keyword = $state("");
    let appliedKeyword = $state("");
    let kind = $state<PageKind | "">("");
    let sort = $state<PageQuery["sort"]>("updated");
    let offset = $state(0);
    let selectedTags = $state<string[]>([]);
    let tags = $state<string[]>([]);
    let tagNames = $state<Record<string, string>>({});
    let selected = $state<string[]>([]);
    let result = $state<PageList>({ items: [], total: 0 });
    let pending = $state(false);
    let error = $state("");
    let doi = $state("");
    let properties = $state<PropertyDefinition[]>([]);
    let propertyName = $state("");
    let batchTag = $state(""), batchProperty = $state(""), batchValue = $state("");
    let filterProperty = $state(""), filterValue = $state("");
    let propertyFilters = $state<Record<string, string | number | boolean | null>>({});
    let propertyType = $state<PropertyDefinition["type"]>("string");
    let request = 0;
    const busy = $derived(!!knowledgeState.operation);
    const query = $derived<PageQuery>({ keyword: appliedKeyword, kind: view === "papers" ? "paper" : kind, deleted: view === "trash", pinned: view === "pinned", tags: selectedTags, properties: propertyFilters, sort, offset, limit: 40 });

    function typedValue(id: string, value: string): string | number | boolean | null {
        if (!value) return null;
        const type = properties.find(item => item.id === id)?.type;
        if (type === "number") { const number = Number(value); if (!Number.isFinite(number)) throw new Error("请输入有效的数字。"); return number; }
        if (type === "boolean") { if (!["true", "false"].includes(value)) throw new Error("勾选属性请填写 true 或 false。"); return value === "true"; }
        return value;
    }
    function addFilter(): void { try { propertyFilters = { ...propertyFilters, [filterProperty]: typedValue(filterProperty, filterValue) }; offset = 0; error = ""; } catch (cause) { error = String(cause); } }
    function batchSetProperty(): void { try { void bulk({ properties: { [batchProperty]: typedValue(batchProperty, batchValue) } }); } catch (cause) { error = String(cause); } }
    async function bulk(changes: PageChanges): Promise<void> { await perform("正在批量更新页面", async () => { if (!await saveAll()) throw new Error("请先解决页面保存错误。"); await window.api.knowledge.updateMany([...selected], changes); knowledgeState.notice = `已更新 ${selected.length} 个页面。`; }); }
    function kindLabel(kind: PageKind): string { return kinds.find(item => item.value === kind)?.label ?? kind; }
    async function load(): Promise<void> {
        const id = ++request;
        pending = true;
        error = "";
        try {
            const [pages, names, definitions] = await Promise.all([window.api.knowledge.list($state.snapshot(query)), window.api.knowledge.tags(), window.api.knowledge.properties()]);
            if (id !== request) return;
            if (offset && !pages.items.length) { offset = Math.max(0, offset - 40); return; }
            result = pages;
            tags = names;
            properties = definitions;
            selected = selected.filter(id => result.items.some(item => item.id === id));
        }
        catch (cause) { if (id === request) error = cause instanceof Error ? cause.message : "加载失败，请重试。"; }
        finally { if (id === request) pending = false; }
    }
    $effect(() => { query; knowledgeState.version; untrack(() => { void load(); }); });

    function imported(result: ImportResult): void {
        if (result.cancelled) return;
        knowledgeState.notice = `已导入或找到 ${result.pages.length} 篇文献。${result.errors.length ? `\n${result.errors.join("\n")}` : ""}`;
        if (result.pages.length === 1) openPage(result.pages[0]);
    }
    function importPDF(): void { void perform("正在导入 PDF…", async () => imported(await window.api.knowledge.importPDF())); }
    function importBib(): void { void perform("正在导入 BibTeX…", async () => imported(await window.api.knowledge.importBibTeX())); }
    async function importDOI(event: SubmitEvent): Promise<void> { event.preventDefault(); await perform("正在获取 DOI 元数据…", async () => { openPage(await window.api.knowledge.importDOI(doi)); doi = ""; }); }
    async function addProperty(event: SubmitEvent): Promise<void> { event.preventDefault(); await perform("正在添加属性…", async () => { await window.api.knowledge.saveProperty({ id: `custom:${crypto.randomUUID()}`, name: propertyName, type: propertyType }); propertyName = ""; }); }
    function trashPages(): void { if (confirm(`将选中的 ${selected.length} 个页面移入回收站？失去最后一个有效链接的非独立页面也会进入回收站。`)) void perform("正在移入回收站…", async () => { if (!await saveAll()) throw new Error("请先解决页面保存错误。"); await window.api.knowledge.trash([...selected]); selected = []; }); }
    function restorePages(): void { void perform("正在恢复页面…", async () => { await window.api.knowledge.restore([...selected]); selected = []; }); }
    function exportPages(): void { void perform("正在导出 Markdown…", async () => { if (!await saveAll()) throw new Error("请先解决页面保存错误。"); const path = await window.api.knowledge.exportMarkdown([...selected]); if (path) knowledgeState.notice = `已导出到 ${path}`; }); }
    function exportBib(): void { void perform("正在导出 BibTeX…", async () => { if (!await saveAll()) throw new Error("请先解决页面保存错误。"); const path = await window.api.knowledge.exportBibTeX([...selected]); if (path) knowledgeState.notice = `已导出到 ${path}`; }); }
</script>