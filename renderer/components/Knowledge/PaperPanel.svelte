<section class="paper-card paper-panel">
    <header><h2>阅读与批注</h2>{#if attachments.length}<select aria-label="PDF 版本" value={selected} onchange={event => { selected = event.currentTarget.value; }} disabled={loading}>{#each attachments as attachment}<option value={attachment.id}>{attachment.version}，{attachment.name}</option>{/each}</select>{/if}<button class="button" onclick={importPDF}>添加 PDF 版本</button></header>
    {#if error}<div class="notice error" role="alert">{error}<button class="text-button" onclick={() => open(selected)}>重新加载</button></div>{/if}
    {#if loading}<div class="empty-state" role="status">正在打开文献…</div>{:else if source}<div class="paper-reader"><Reader bind:this={reader} {source} viewState={position ?? undefined} {annotations} onAnnotate={annotate} onOpenAnnotation={annotation => openPage({ id: annotation.pageId, title: annotation.quote || "阅读批注" })} onViewStateChange={savePosition} onMetadata={metadata} /></div>{:else}<div class="empty-state"><Icon name="book" size={32} /><strong>给这篇文献添上原文</strong><p>导入 PDF 后，可以继续上次阅读、标注原文并保留多个版本。</p></div>{/if}
    {#if annotations.length}<details class="annotation-list" open><summary>此版本的批注（{annotations.length}）</summary>{#each annotations as annotation (annotation.id)}<div class="annotation-row"><button class="annotation-text" onclick={() => { reader?.goToPage(annotation.pageNumber); }}><span class="badge">第 {annotation.pageNumber} 页</span><span>{annotation.quote || "区域批注"}</span></button><select aria-label="批注颜色" value={annotation.color} onchange={event => recolor(annotation.id, event.currentTarget.value)}><option value="yellow">黄</option><option value="green">绿</option><option value="blue">蓝</option><option value="pink">粉</option></select><button class="text-button" onclick={() => openPage({ id: annotation.pageId, title: annotation.quote || "阅读批注" })}>编辑批注</button><button class="text-button" onclick={() => remove(annotation)}>删除</button></div>{/each}</details>{/if}
    {#if attachments.length > 1}<p class="version-hint">每个版本分别保留原文、阅读位置和标注。切换版本不会覆盖旧版本。</p>{/if}
</section>


<style>
    .paper-panel { margin-top: 20px; overflow: hidden; box-shadow: none; }
    header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--c-line); }
    h2 { margin: 0 auto 0 0; font-size: 13px; }
    select { max-width: min(100%, 300px); min-width: 0; padding: 7px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); font: inherit; font-size: 11px; }
    .paper-reader { height: 660px; max-height: 85vh; min-height: 320px; }
    .annotation-list { padding: 14px 18px; border-top: 1px solid var(--c-line); font-size: 11px; }
    summary { cursor: pointer; font-weight: 800; }
    .annotation-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 13px 0; border-bottom: 1px dashed var(--c-line); }
    .annotation-text { flex: 1; min-width: 140px; text-align: left; line-height: 1.8; }
    .annotation-text > span:last-child { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 6px; }
    .version-hint { padding: 0 18px 14px; color: var(--c-muted); font-size: 11px; }
</style>


<script lang="ts">
    import { untrack } from "svelte";
    import type { Annotation, Attachment, ReadingPosition } from "../../../shared/types/knowledge";
    import type { ReaderSource } from "../Reader/defs";
    import Reader from "../Reader/Reader.svelte";
    import Icon from "../utils/Icon.svelte";
    import { openPage } from "../layout/navigation";
    import { changed, editPage, sessions, readingNavigation, knowledgeState, perform, savePage } from "./state.svelte";

    let { pageId }: { pageId: string } = $props();
    let reader = $state<Reader>();
    let attachments = $state<Attachment[]>([]);
    let selected = $state("");
    let source = $state.raw<ReaderSource | null>(null);
    let position = $state<ReadingPosition | null>(null);
    let annotations = $state<Annotation[]>([]);
    let loading = $state(false);
    let error = $state("");
    let request = 0;
    const sourceIds = new WeakMap<ReaderSource, string>();
    $effect(() => { const id = pageId; knowledgeState.version; untrack(() => { void refresh(id); }); });
    $effect(() => { const id = selected; untrack(() => { if (id) void open(id); }); });
    $effect(() => {
        const target = readingNavigation.target; const current = selected; const ready = !loading && !!source; const viewer = reader;
        if (target?.pageId !== pageId) return;
        untrack(() => {
            if (target.attachmentId !== current) selected = target.attachmentId;
            else if (ready && viewer) { viewer.goToPage(target.pageNumber); readingNavigation.target = null; }
        });
    });
    async function refresh(id: string): Promise<void> {
        try { const list = await window.api.knowledge.attachments(id); if (id !== pageId) return; attachments = list; if (!selected) selected = list[0]?.id ?? ""; if (selected) annotations = await window.api.knowledge.annotations(selected); }
        catch (cause) { error = cause instanceof Error ? cause.message : "无法读取文献附件。"; }
    }
    async function open(id: string): Promise<void> {
        const current = ++request; loading = true; error = ""; source = null;
        try {
            const [data, saved, notes] = await Promise.all([window.api.knowledge.readAttachment(id), window.api.knowledge.getPosition(id), window.api.knowledge.annotations(id)]);
            if (request !== current) return;
            const target = readingNavigation.target;
            position = target?.pageId === pageId && target.attachmentId === id ? { pageNumber: target.pageNumber, scale: saved?.scale ?? "auto", rotation: saved?.rotation ?? 0, top: 0, left: 0 } : saved;
            if (target?.pageId === pageId && target.attachmentId === id) readingNavigation.target = null;
            annotations = notes;
            const next: ReaderSource = { kind: "data", data: new Uint8Array(data) };
            sourceIds.set(next, id); source = next;
        }
        catch (cause) { if (current === request) error = cause instanceof Error ? cause.message : "PDF 打开失败。"; }
        finally { if (current === request) loading = false; }
    }
    function savePosition(value: ReadingPosition, current: ReaderSource): void {
        const id = sourceIds.get(current); if (!id) return;
        void window.api.knowledge.setPosition(id, value).catch(cause => { error = `阅读位置保存失败：${String(cause)}`; });
    }
    function metadata(info: { title: string; authors: string }): void {
        const page = sessions[pageId]?.page;
        const attachment = attachments.find(item => item.id === selected);
        if (!page?.paper || !attachment) return;
        const patch: Parameters<typeof editPage>[1] = {};
        if (info.title && page.title === attachment.name.replace(/\.pdf$/i, "")) patch.title = info.title;
        if (info.authors && !page.paper.authors) patch.paper = { ...page.paper, authors: info.authors };
        if (Object.keys(patch).length) editPage(pageId, patch);
    }
    async function importPDF(): Promise<void> { await perform("正在导入文献版本", async () => { if (!await savePage(pageId)) throw new Error("请先解决页面保存错误。"); const result = await window.api.knowledge.importPDF(pageId); if (result.errors.length) knowledgeState.error = result.errors.join("\n"); if (result.pages.length) { const list = await window.api.knowledge.attachments(pageId); attachments = list; selected = list[0]?.id ?? ""; } }); }
    async function annotate(input: Pick<Annotation, "pageNumber" | "quote" | "rects" | "color">): Promise<void> { const annotation = await window.api.knowledge.annotate({ ...input, attachmentId: selected }); annotations = [...annotations, annotation]; changed(); }
    async function recolor(id: string, color: string): Promise<void> { await perform("正在更新标注", async () => { await window.api.knowledge.changeAnnotation(id, color); annotations = annotations.map(annotation => annotation.id === id ? { ...annotation, color } : annotation); }); }
    async function remove(annotation: Annotation): Promise<void> { if (!confirm("将此批注页移入回收站？恢复后标注会重新显示。")) return; await perform("正在删除批注", () => window.api.knowledge.trash([annotation.pageId])); }
</script>