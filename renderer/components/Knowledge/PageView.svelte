<section class="workspace-page page-view">
    {#if page}
        <header class="document-heading"><span class="badge">{labels[page.kind]}</span><span>{session?.saving ? "保存中…" : session?.dirty ? "有未保存的更改" : "已保存到工作区"}</span><button class="text-button" onclick={() => editPage(pageId, { pinned: !page.pinned })} disabled={page.deleted}>{page.pinned ? "取消固定" : "固定到侧栏"}</button></header>
        {#if session?.error}<div class="notice error" role="alert"><p>{session.error}</p><div class="actions"><button class="button" onclick={() => savePage(pageId)}>重试保存</button><button class="button" onclick={saveCopy}>保留为新副本</button><button class="text-button" onclick={reload}>放弃本地更改，重新载入</button></div></div>{/if}
        {#if page.deleted}<div class="notice">这个页面在回收站中。<button class="button" onclick={() => perform("正在恢复页面", async () => { await window.api.knowledge.restore([pageId]); await loadPage(pageId, true); })}>恢复页面</button></div>{/if}
        <input class="document-title" aria-label="页面标题" value={page.title} maxlength={500} disabled={page.deleted} oninput={event => editPage(pageId, { title: event.currentTarget.value })} />
        <div class="page-tags">{#each page.tags as tag}<button class="badge" disabled={page.deleted} onclick={() => editPage(pageId, { tags: page.tags.filter(item => item !== tag) })} title="移除此标签">{tag} ×</button>{/each}<form onsubmit={addTag}><input aria-label="添加标签" placeholder="添加标签…" bind:value={newTag} maxlength={100} disabled={page.deleted} /><button class="text-button" disabled={page.deleted || !newTag.trim()}>添加</button></form></div>
        <details class="paper-card metadata"><summary>页面属性与操作</summary><div class="metadata-body">
            <label class="check"><input type="checkbox" checked={page.independent} disabled={page.deleted} onchange={setIndependent} />独立保留此页面</label><p class="hint">关闭后，页面在不再被独立页面引用时会进入回收站。</p>
            <div class="property-grid">{#each properties as property}<label>{property.name}{#if property.type === "boolean"}<input type="checkbox" checked={page.properties[property.id] === true} disabled={page.deleted} onchange={event => propertyValue(property.id, event.currentTarget.checked)} />{:else}<input type={property.type === "number" ? "number" : property.type === "date" ? "date" : "text"} value={String(page.properties[property.id] ?? "")} disabled={page.deleted} oninput={event => propertyValue(property.id, property.type === "number" ? event.currentTarget.value === "" ? null : Number(event.currentTarget.value) : event.currentTarget.value || null)} />{/if}</label>{/each}</div>
            <div class="actions"><button class="button" onclick={exportPage}>导出 Markdown</button>{#if page.kind === "paper"}<button class="button" onclick={exportCitation}>导出 BibTeX</button>{/if}{#if !page.deleted}<button class="text-button danger" onclick={trash}>移入回收站</button>{/if}<span class="hint">更新于 {new Date(page.updatedAt).toLocaleString("zh-CN")}</span></div>
        </div></details>
        {#if page.paper}<details class="paper-card metadata" open><summary>文献信息</summary><fieldset class="metadata-body" disabled={page.deleted}><div class="property-grid">{#each paperFields as field}<label>{field.label}<input value={page.paper[field.key]} oninput={event => editPage(pageId, { paper: { ...page.paper!, [field.key]: event.currentTarget.value } })} /></label>{/each}</div><label>摘要<textarea rows="4" value={page.paper.abstract} oninput={event => editPage(pageId, { paper: { ...page.paper!, abstract: event.currentTarget.value } })}></textarea></label>{#if page.paper.url}<button class="text-button" onclick={() => perform("正在打开来源", () => window.api.knowledge.openURL(page.paper!.url))}>打开文献来源 ↗</button>{/if}</fieldset></details>{/if}
        {#if page.schedule}<details class="paper-card metadata" open><summary>时间与计划</summary><fieldset class="metadata-body" disabled={page.deleted}><ScheduleFields value={page.schedule} onchange={schedule => editPage(pageId, { schedule })} /></fieldset></details>{/if}
        {#if page.kind === "paper" && !page.deleted}<PaperPanel {pageId} />{/if}
        {#if origin}<div class="notice">此批注来自 {origin.version} 的第 {origin.pageNumber} 页。<button class="button" onclick={() => { readingNavigation.target = { pageId: origin!.paperId, attachmentId: origin!.attachmentId, pageNumber: origin!.pageNumber }; openPage({ id: origin!.paperId, title: origin!.title }); }}>回到原文</button></div>{/if}
        <div class="paper-card writing-area"><Editor {pageId} readonly={page.deleted} /></div>
        <section class="backlinks"><h2>被这些页面提及 <span class="badge">{links.length}</span></h2>{#if links.length}<div class="link-list">{#each links as link (link.id)}<button class="button" onclick={() => openPage({ id: link.sourceId, title: link.title })}>{link.title}<span class="badge">{link.deleted ? "已删除" : link.mode === "sync" ? "同步" : "引用"}</span></button>{/each}</div>{:else}<p>插入页面链接后，关联的想法会出现在这里。</p>{/if}</section>
    {:else if session?.error}<div class="empty-state"><p class="notice error">{session.error}</p><button class="button" onclick={() => loadPage(pageId, true)}>重新加载</button></div>{:else}<div class="empty-state" role="status">正在打开页面…</div>{/if}
</section>


<style>
    .page-view { max-width: 1200px; }
    .document-heading, .page-tags, .actions, .link-list { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .document-heading { color: var(--c-muted); font-size: 11px; }
    .document-heading .text-button { margin-left: auto; }
    .document-title { width: 100%; margin: 18px 0 13px; border: 0; border-bottom: 1px solid transparent; background: transparent; color: var(--c-ink); font: inherit; font-size: clamp(23px, 3vw, 32px); font-weight: 900; }
    .document-title:focus { outline: 0; border-color: var(--c-accent); }
    .page-tags { margin-bottom: 22px; }
    .page-tags form { display: flex; align-items: center; gap: 6px; }
    .page-tags input { width: 100px; border: 0; padding: 6px; border-radius: 5px; background: transparent; font: inherit; font-size: 11px; }
    .metadata { margin: 14px 0; box-shadow: none; }
    summary { padding: 14px 18px; cursor: pointer; font-size: 12px; font-weight: 800; }
    .metadata-body { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 4px 18px 18px; border: 0; min-width: 0; }
    .metadata-body label { display: flex; flex-direction: column; gap: 6px; color: var(--c-muted); font-size: 11px; }
    .metadata-body label.check { flex-direction: row; align-items: center; }
    .metadata-body input:not([type="checkbox"]), textarea { width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); font: inherit; }
    textarea { resize: vertical; line-height: 1.8; }
    .property-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
    .hint, .backlinks p { margin: 0; color: var(--c-muted); font-size: 11px; line-height: 1.8; }
    .danger { color: var(--c-error); }
    .writing-area { margin-top: 22px; overflow: hidden; }
    .backlinks { margin-top: 28px; }
    .backlinks h2 { display: flex; gap: 10px; align-items: center; font-size: 13px; }
</style>


<script lang="ts">
    import { untrack } from "svelte";
    import type { AnnotationOrigin, LinkRecord, PageKind, PaperMetadata, PropertyDefinition } from "../../../shared/types/knowledge";
    import Editor from "../Editor/Editor.svelte";
    import ScheduleFields from "./ScheduleFields.svelte";
    import PaperPanel from "./PaperPanel.svelte";
    import { openPage } from "../layout/navigation";
    import { acceptPage, changed, readingNavigation, editPage, knowledgeState, loadPage, perform, savePage, sessions } from "./state.svelte";

    let { pageId }: { pageId: string } = $props();
    const session = $derived(sessions[pageId]);
    const page = $derived(session?.page);
    let newTag = $state("");
    let origin = $state<AnnotationOrigin | null>(null);
    let links = $state<LinkRecord[]>([]);
    let properties = $state<PropertyDefinition[]>([]);
    const labels: Record<PageKind, string> = { editable: "知识页面", paper: "文献", task: "任务", event: "日程", annotation: "阅读批注" };
    const paperFields: { key: Exclude<keyof PaperMetadata, "abstract">; label: string }[] = [{ key: "authors", label: "作者" }, { key: "year", label: "年份" }, { key: "venue", label: "期刊 / 会议" }, { key: "doi", label: "DOI" }, { key: "url", label: "来源网址" }];
    $effect(() => {
        const id = pageId; knowledgeState.version;
        untrack(() => {
            void loadPage(id, true);
            void Promise.all([window.api.knowledge.backlinks(id), window.api.knowledge.properties(), window.api.knowledge.annotationOrigin(id)]).then(([values, definitions, source]) => { if (id === pageId) { links = values; properties = definitions; origin = source; } }).catch(error => { knowledgeState.error = String(error); });
        });
    });
    function addTag(event: SubmitEvent): void { event.preventDefault(); if (!page || !newTag.trim()) return; editPage(pageId, { tags: [...new Set([...page.tags, newTag.trim()])] }); newTag = ""; }
    function propertyValue(id: string, value: string | number | boolean | null): void { if (page) editPage(pageId, { properties: { ...page.properties, [id]: value } }); }
    function setIndependent(event: Event): void {
        const checked = (event.currentTarget as HTMLInputElement).checked;
        if (!checked && !confirm("关闭独立保留后，如果没有其他独立页面引用它，此页面将进入回收站。继续吗？")) { (event.currentTarget as HTMLInputElement).checked = true; return; }
        editPage(pageId, { independent: checked });
    }
    async function reload(): Promise<void> { if (!confirm("放弃此页面尚未保存的更改并重新载入？")) return; session.dirty = false; session.sequence++; await loadPage(pageId, true); }
    async function saveCopy(): Promise<void> {
        if (!page) return;
        await perform("正在保留副本", async () => {
            const current = $state.snapshot(page);
            const copy = await window.api.knowledge.create({ title: `${current.title}（副本）`, kind: current.kind === "annotation" ? "editable" : current.kind, document: current.document, ...(current.paper ? { paper: current.paper } : {}), ...(current.schedule ? { schedule: current.schedule } : {}) });
            acceptPage(copy); openPage(copy); knowledgeState.notice = "副本已保存。原页面的未保存更改仍保留，可重新载入原页面。";
        });
    }
    async function trash(): Promise<void> { if (!confirm("将此页面移入回收站？之后可以恢复。")) return; await perform("正在移入回收站", async () => { if (!await savePage(pageId)) throw new Error("请先解决页面保存错误。"); await window.api.knowledge.trash([pageId]); await loadPage(pageId, true); changed(); }); }
    async function exportPage(): Promise<void> { await perform("正在导出页面", async () => { if (!await savePage(pageId)) throw new Error("请先解决页面保存错误。"); const path = await window.api.knowledge.exportMarkdown([pageId]); if (path) knowledgeState.notice = `已导出到 ${path}`; }); }
    async function exportCitation(): Promise<void> { await perform("正在导出引用", async () => { if (!await savePage(pageId)) throw new Error("请先解决页面保存错误。"); const path = await window.api.knowledge.exportBibTeX([pageId]); if (path) knowledgeState.notice = `已导出到 ${path}`; }); }
</script>