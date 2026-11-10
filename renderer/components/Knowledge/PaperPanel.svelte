<section class="paper-panel">
    <header>
        <div class="attachments">
            <select value={fileId} onchange={event => void openFile(event.currentTarget.value)}>
                {#each resources.files as file (file.id)}
                    <option value={file.id}>{file.originalName}</option>
                {:else}
                    <option value="">暂无 PDF 附件</option>
                {/each}
            </select>
            <button class="button" disabled={busy || !!page.attributes.deleted} onclick={attach}>添加 PDF</button>
        </div>
        <button class="text-button" onclick={toggleExpanded}>{expanded ? "收起阅读器" : "展开阅读器"}</button>
    </header>
    {#if error}
        <div class="notice error">{error}<button onclick={() => void openFile(fileId)}>重试读取</button></div>
    {/if}
    {#if expanded}
        {#if resources.files.length}
            <div class="paper-reader">
                <Reader bind:this={reader} {source} {fileId} {viewState} anchors={resources.anchors} highlights={resources.highlights} onSelection={selectText} onHighlight={selectHighlight} onViewStateChange={savePosition} onPasswordAccepted={unlock} />
            </div>
        {:else}
            <div class="empty-state">
                <p>添加 PDF 后，即可阅读、标记和创建批注。</p>
            </div>
        {/if}
        {#if (selection || activeHighlight) && !annotationId}
            <div class="selection-menu" popover="manual" {@attach element => {
                element.showPopover();
            }} role="toolbar" aria-label="高亮与批注" style:left={menuLeft + "px"} style:top={menuTop + "px"}>
                {#each colors as item (item.value)}
                    <button class="swatch" style:background={item.value} aria-label={item.label + "高亮"} title={item.label} disabled={busy || !!page.attributes.deleted} onclick={() => markColor(item.value)}></button>
                {/each}
                <button disabled={busy || !!page.attributes.deleted} onclick={annotateSelection}>{resources.highlights.find(item => item.id === activeHighlight)?.annotationId ? "编辑批注" : activeHighlight ? "添加批注" : "批注"}</button>
                {#if activeHighlight}<button disabled={busy || !!page.attributes.deleted} onclick={() => remove(activeHighlight!)}>删除</button>{/if}
                <button onclick={dismiss}>关闭</button>
            </div>
        {/if}
        {#if annotationId}
            {#key annotationId}
                <AnnotationPopover pageId={annotationId} {tabId} position={menuPosition} onclose={() => annotationId = null} />
            {/key}
        {/if}
    {/if}
</section>
<style>
    .paper-panel { border-bottom: 1px solid var(--c-line); background: var(--c-cream); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; }
    .attachments { display: flex; align-items: center; gap: 10px; min-width: 0; }
    select { padding: 7px; border: 1px solid var(--c-line); border-radius: 5px; background: var(--c-paper); color: var(--c-ink); min-width: 0; max-width: 300px; font-size: 12px; }
    .paper-reader { height: 65vh; min-height: 400px; }
    .selection-menu { position: fixed; inset: auto; margin: 0; z-index: 65; display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); box-shadow: 0 3px 12px #0002; font-size: 12px; }
    .selection-menu button { padding: 3px; }
    .selection-menu .swatch { width: 22px; height: 22px; border: 1px solid var(--c-line); border-radius: 50%; }
    .notice { margin: 10px 20px; }
</style>
<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { type PageRecord } from "../../../shared/types/content";
    import { type Anchor, type AnchorInput, type PaperResources } from "../../../shared/types/papers";
    import { record } from "../../../shared/attrs/values";
    import { type ReaderSource, type ReaderViewState } from "../Reader/defs";
    import Reader from "../Reader/Reader.svelte";
    import AnnotationPopover from "./AnnotationPopover.svelte";
    import { knowledgeState, message, perform, trackWrite, writeFromTab, confirmed, session as pageSession, type PageSession } from "./state.svelte";
    import { openPage } from "../layout/navigation";
    let { page, session, tabId, anchorId }: { page: PageRecord; session: PageSession; tabId: string; anchorId?: string } = $props();
    let resources = $state<PaperResources>({ files: [], anchors: [], highlights: [] }), fileId = $state(""), source = $state.raw<ReaderSource | null>(null), viewState = $state<ReaderViewState | undefined>(undefined);
    let reader = $state<Reader | null>(null), selection = $state<AnchorInput | null>(null), expanded = $state(true), busy = $state(false), error = $state("");
    let activeHighlight = $state<string | null>(null), annotationId = $state<string | null>(null);
    let menuPosition = $state({ x: 0, y: 0 });
    const menuLeft = $derived(Math.max(12, Math.min(menuPosition.x, window.innerWidth - 310)));
    const menuTop = $derived(Math.max(48, Math.min(menuPosition.y + 8, window.innerHeight - 60)));
    const colors = [{ value: "#F2D675", label: "黄色" }, { value: "#A9C5A0", label: "绿色" }, { value: "#C5B6DC", label: "紫色" }, { value: "#F1B6A7", label: "粉色" }];
    let request = 0;
    async function unlock(password: string): Promise<void> {
        await window.api.knowledge.unlockPDF(fileId, password);
        await load();
    }
    async function selectText(value: AnchorInput | null, at?: { x: number; y: number }): Promise<void> {
        selection = value;
        if (at) menuPosition = at;
        if (value) {
            activeHighlight = null;
            if (annotationId && await pageSession(tabId, annotationId).flush()) annotationId = null;
        }
    }
    let locatedId: string | undefined;
    const sourceFiles = new WeakMap<ReaderSource, string>();
    async function load(): Promise<void> {
        try {
            resources = await window.api.knowledge.resources(page.id);
            if (!fileId && resources.files[0]) await openFile(resources.files[0].id);
        }
        catch (problem) {
            error = message(problem);
        }
    }
    onMount(() => {
        const off = session.watchObject(page.id, load);
        return () => {
            off();
            request++;
        };
    });
    $effect(() => {
        const anchor = resources.anchors.find(item => item.id === anchorId);
        if (anchor && reader && locatedId !== anchor.id) untrack(() => {
            locatedId = anchor.id;
            void locate(anchor);
        });
    });
    async function toggleExpanded(): Promise<void> {
        if (annotationId && !await pageSession(tabId, annotationId).flush()) return;
        annotationId = null;
        dismiss();
        expanded = !expanded;
    }
    async function openFile(id: string): Promise<void> {
        if (!id) return;
        if (annotationId && !await pageSession(tabId, annotationId).flush()) return;
        annotationId = null;
        const sequence = ++request;
        try {
            const data = await window.api.knowledge.readFile(id);
            if (sequence !== request) return;
            window.dispatchEvent(new Event("workspace-flush"));
            source = null;
            selection = null;
            fileId = id;
            const position = record(page.attributes.reading_position) ? page.attributes.reading_position[id] : null;
            viewState = record(position) ? { pageNumber: Number(position.page), scale: position.scale as ReaderViewState["scale"], rotation: position.rotation as ReaderViewState["rotation"], left: Number(position.left), top: Number(position.top) } : undefined;
            source = { kind: "data", data: new Uint8Array(data) };
            sourceFiles.set(source, id);
            error = "";
        }
        catch (problem) {
            if (sequence === request) {
                error = message(problem);
                fileId = id;
                source = null;
            }
        }
    }
    function savePosition(state: ReaderViewState, current: ReaderSource): void {
        const id = sourceFiles.get(current);
        if (page.attributes.deleted || !id) return;
        const request = window.api.knowledge.position(page.id, id, { page: state.pageNumber, scale: state.scale, rotation: state.rotation, left: state.left, top: state.top }, tabId);
        trackWrite(tabId, request);
        void request.catch(problem => {
            error = message(problem);
            knowledgeState.error = error;
        });
    }
    async function attach(): Promise<void> {
        busy = true;
        try {
            if (await writeFromTab(tabId, () => window.api.knowledge.importPDF(page.id, tabId))) await load();
        }
        catch (problem) {
            error = message(problem);
        }
        finally {
            busy = false;
        }
    }
    function dismiss(): void {
        selection = null;
        activeHighlight = null;
        reader?.clearSelection();
    }
    async function selectHighlight(id: string, at: { x: number; y: number }, annotation = false): Promise<void> {
        if (annotationId && !await pageSession(tabId, annotationId).flush()) return;
        dismiss();
        menuPosition = at;
        const highlight = resources.highlights.find(item => item.id === id);
        if (annotation && highlight?.annotationId) annotationId = highlight.annotationId;
        else {
            annotationId = null; activeHighlight = id;
        }
    }
    async function markColor(color: string): Promise<void> {
        if (!selection && !activeHighlight) return;
        busy = true;
        try {
            const anchor = selection ? $state.snapshot(selection) : null, id = activeHighlight;
            await writeFromTab(tabId, async () => {
                if (id) await window.api.knowledge.changeHighlight(id, color, tabId);
                else if (anchor) await window.api.knowledge.highlight(page.id, anchor, color, tabId);
                dismiss();
                await load();
            });
        }
        catch (problem) {
            error = message(problem);
        }
        finally {
            busy = false;
        }
    }
    async function annotateSelection(): Promise<void> {
        const existing = resources.highlights.find(item => item.id === activeHighlight);
        const anchor = existing?.anchorId ?? (selection ? $state.snapshot(selection) : null);
        if (!anchor) return;
        busy = true;
        try {
            await writeFromTab(tabId, async () => {
                const id = await window.api.knowledge.annotate(page.id, anchor, tabId, existing?.color);
                await session.reread([page.id]);
                dismiss();
                await load();
                annotationId = id;
            });
        }
        catch (problem) {
            error = message(problem);
        }
        finally {
            busy = false;
        }
    }
    async function locate(anchor: Anchor): Promise<void> {
        if (fileId !== anchor.fileId) await openFile(anchor.fileId);
        expanded = true;
        reader?.goToAnchor(anchor);
    }
    function remove(id: string): void {
        void perform(async () => {
            await writeFromTab(tabId, async () => {
                if (await confirmed(token => window.api.knowledge.removeHighlight(id, tabId, token))) {
                    dismiss();
                    await session.reread([page.id]);
                    await load();
                }
            });
        });
    }
</script>