<script module lang="ts">
    import { type ReaderAnchor } from "../Reader/defs";
    import { type PageSession } from "./page-session.svelte";

    type Point = { x: number; y: number };
    type OpenAnnotation = { id: string; fileId: string; anchor: ReaderAnchor; position: Point | null };
    type AnnotationSlot = { note: OpenAnnotation | null };
    // A split can rebuild the group while its tab and page session survive.
    const annotationSlots = new WeakMap<PageSession, AnnotationSlot>();
    function slotFor(session: PageSession): AnnotationSlot {
        const existing = annotationSlots.get(session);
        if (existing) return existing;
        const slot = $state<AnnotationSlot>({ note: null });
        annotationSlots.set(session, slot);
        return slot;
    }
</script>

<script lang="ts">
    import { Tabs } from "bits-ui";
    import { onMount, untrack } from "svelte";
    import { record } from "../../../shared/attrs/values";
    import { annotationColors } from "../../../shared/content/annotations";
    import { isComposingKey } from "../../../shared/content/commands";
    import type { PageRecord } from "../../../shared/types/content";
    import type { AnnotationInput, Attachment, PaperAnnotation } from "../../../shared/types/papers";
    import type { ViewParams } from "../../../shared/workspace/views";
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Tooltip from "../base/Tooltip.svelte";
    import Select from "../base/Select.svelte";
    import { showLayer } from "../base/top-layer";
    import { openPage } from "../layout/navigation";
    import { AnchorLayout, controlsReaderView } from "../Reader/anchor-layout";
    import { type ReaderAnchorGeometry, type ReaderSource, type ReaderViewState } from "../Reader/defs";
    import Reader from "../Reader/Reader.svelte";
    import { tabState } from "../Tab/state.svelte";
    import Resizer from "../utils/Resizer.svelte";
    import AnnotationList from "./AnnotationList.svelte";
    import AnnotationPopover from "./AnnotationPopover.svelte";
    import { confirmed } from "./confirmation.svelte";
    import { knowledgeState, perform } from "./feedback.svelte";
    import { importPapers } from "./library-import.svelte";
    import { write } from "./page-sessions";
    import PageInformation from "./PageInformation.svelte";

    type Params = ViewParams["page"];
    let { page, session, tabId, params, onparams, syncing }: {
        page: PageRecord; session: PageSession; tabId: string; params: Params;
        onparams: (params: Params) => void; syncing: boolean;
    } = $props();

    let pdfs = $state.raw<Attachment[]>([]), annotations = $state.raw<PaperAnnotation[]>([]);
    let fileId = $state(""), source = $state.raw<ReaderSource | null>(null), viewState = $state.raw<ReaderViewState>();
    let reader = $state<Reader>(), selection = $state.raw<AnnotationInput | null>(null), selectedId = $state<string | null>(null);
    const annotationSlot = untrack(() => slotFor(session));
    let toolsOpen = $state(false);
    let annotationPopup = $state<AnnotationPopover>();
    let highlightTools = $state<HTMLDivElement>();
    let paletteWidth = $state(0), paletteHeight = $state(0);
    let placement = $state.raw(new AnchorLayout());
    let measuredAnchor = $state.raw<ReaderAnchorGeometry | null>(null);
    let busy = $state(false), dropping = $state(false), loadingFiles = $state(true);
    let fileError = $state<ErrorValue>(""), annotationError = $state<ErrorValue>("");
    let width = $state(0), infoPanel = $state<HTMLElement | null>(null);
    let fileRequest = 0, openRequest = 0, annotationRequest = 0;
    const sourceFiles = new WeakMap<ReaderSource, string>();
    // Position is read only when reopening that file.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const positions = new Map<string, ReaderViewState>();

    const sidebar = $derived(params.showProperties !== false);
    const sidebarTab = $derived(params.paperSidebar ?? "info");
    const paneWidth = $derived(Math.max(240, Math.min(width - 364, params.infoWidth ?? Math.round(width / 3))));
    const locked = $derived(!!page.attributes.deleted);
    const visible = $derived(tabState.groups.some(group => group.activeTabId === tabId));
    const opened = $derived(annotationSlot.note);
    const editorId = $derived(opened?.id ?? null);
    const filesKey = $derived(JSON.stringify(page.attributes.paper_files ?? []));
    const anchor = $derived(visible ? opened?.anchor ?? (toolsOpen ? selection : null) : null);
    const geometry = $derived(measuredAnchor?.anchor === anchor ? measuredAnchor : null);
    const palette = $derived(!editorId && toolsOpen && geometry && paletteWidth && paletteHeight
        ? placement.place(geometry, paletteWidth, paletteHeight) : null);
    const colors = Object.entries(annotationColors) as [keyof typeof annotationColors, typeof annotationColors[keyof typeof annotationColors]][];

    $effect(() => {
        const ids = JSON.parse(filesKey) as string[];
        void untrack(() => loadFiles(ids));
        return () => {
            fileRequest++;
        };
    });
    $effect(() => {
        const id = fileId;
        void untrack(() => loadAnnotations(id));
        return () => {
            annotationRequest++;
        };
    });
    // Membership, content and recycle changes share one notification. A later
    // session read may replace page attributes without changing the resources.
    onMount(() => window.api.pages.onChanged(change => {
        if (fileId && change.highlightPages?.includes(page.id)) void loadAnnotations(fileId);
    }));
    $effect.pre(() => {
        if ((!sidebar || sidebarTab !== "info") && document.activeElement instanceof HTMLElement && infoPanel?.contains(document.activeElement))
            document.activeElement.blur();
    });
    $effect(() => {
        if (locked || !visible) toolsOpen = false;
    });
    $effect(() => () => {
        openRequest++;
    });

    async function loadFiles(ids: string[]): Promise<void> {
        const sequence = ++fileRequest;
        try {
            const files = ids.length ? await window.api.papers.files(ids) : [];
            if (sequence !== fileRequest) return;
            pdfs = files.filter(file => file.mediaType === "application/pdf");
            if (!pdfs.some(file => file.id === fileId)) {
                const next = pdfs.find(file => file.id === params.fileId) ?? pdfs[0];
                if (next) await openFile(next.id);
                else {
                    openRequest++;
                    source = null;
                    fileId = "";
                    resetSelection();
                }
            }
        }
        catch (error) {
            if (sequence === fileRequest) fileError = failure(error);
        }
        finally {
            if (sequence === fileRequest) loadingFiles = false;
        }
    }

    async function openFile(id: string): Promise<void> {
        if (!pdfs.some(file => file.id === id)) return;
        const sequence = ++openRequest;
        if ((fileId || opened?.fileId !== id) && !await closeAnnotation()) return;
        if (sequence !== openRequest) return;
        window.dispatchEvent(new Event("workspace-flush"));
        if (id !== fileId) annotations = [];
        resetSelection();
        selectedId = editorId;
        fileId = id;
        source = null;
        fileError = "";
        try {
            const data = await window.api.papers.readFile(id);
            if (sequence !== openRequest) return;
            const position = record(page.attributes.reading_position) ? page.attributes.reading_position[id] : null;
            viewState = positions.get(id) ?? (record(position) ? {
                pageNumber: Number(position.page), scale: position.scale as ReaderViewState["scale"], rotation: position.rotation as ReaderViewState["rotation"],
                left: Number(position.left), top: Number(position.top)
            } : undefined);
            source = { kind: "data", data: new Uint8Array(data) };
            sourceFiles.set(source, id);
        }
        catch (error) {
            if (sequence === openRequest) fileError = failure(error);
        }
    }

    async function loadAnnotations(id: string): Promise<void> {
        const sequence = ++annotationRequest;
        if (!id) {
            annotations = [];
            annotationError = "";
            return;
        }
        try {
            const result = await window.api.papers.resources(page.id, id);
            if (sequence !== annotationRequest) return;
            annotations = result.annotations;
            annotationError = "";
            if (selectedId && !annotations.some(annotation => annotation.id === selectedId)) resetSelection();
            if (editorId && !annotations.some(annotation => annotation.id === editorId)) void closeAnnotation();
        }
        catch (error) {
            if (sequence === annotationRequest) annotationError = failure(error);
        }
    }

    async function unlock(password: string): Promise<void> {
        const id = fileId;
        await window.api.papers.unlockPDF(id, password);
        if (id === fileId) await loadAnnotations(id);
    }

    function savePosition(state: ReaderViewState, current: ReaderSource): void {
        const id = sourceFiles.get(current);
        if (locked || !id || !Array.isArray(page.attributes.paper_files) || !page.attributes.paper_files.includes(id)) return;
        positions.set(id, state);
        void write(() => window.api.papers.position(page.id, id, { page: state.pageNumber, scale: state.scale, rotation: state.rotation, left: state.left, top: state.top }))
            .catch(problem => {
                const error = failure(problem);
                if (error.kind !== "page-recycled-readonly") knowledgeState.error = error;
            });
    }

    function resetSelection(): void {
        setToolsOpen(false);
        selection = null;
        selectedId = null;
        reader?.clearSelection();
    }

    async function closeAnnotation(): Promise<boolean> {
        if (annotationPopup) return annotationPopup.close(false);
        forgetAnnotation();
        return true;
    }
    function forgetAnnotation(): void {
        annotationSlot.note = null;
    }
    function openAnnotation(id: string, { pageNumber, rectangles }: ReaderAnchor): void {
        annotationSlot.note = { id, fileId, anchor: { pageNumber, rectangles }, position: null };
    }
    function retainAnnotation(note: OpenAnnotation): boolean {
        return annotationSlot.note === note && tabState.groups.some(group => group.tabs.some(tab =>
            tab.id === tabId && tab.view.type === "page" && tab.view.params.page.id === page.id));
    }

    function selectText(value: AnnotationInput | null): void {
        selection = value;
        if (value) selectedId = null;
        setToolsOpen(!!value && !locked);
    }
    function setToolsOpen(value: boolean): void {
        if (!value && highlightTools?.contains(document.activeElement)) reader?.focusViewer();
        if (value && !toolsOpen) placement = new AnchorLayout();
        toolsOpen = value;
    }
    function mountPalette(element: HTMLElement): () => void {
        const hide = showLayer(element, () => setToolsOpen(false));
        function dismiss(event: PointerEvent): void {
            if (event.button !== 0 || event.composedPath().includes(element)) return;
            const view = geometry?.viewport;
            if (view && controlsReaderView(event, view)) return;
            setToolsOpen(false);
        }
        document.addEventListener("pointerdown", dismiss, true);
        return () => {
            document.removeEventListener("pointerdown", dismiss, true);
            hide();
        };
    }
    function focusSelectionTools(): boolean {
        const first = palette?.visible && highlightTools?.querySelector<HTMLButtonElement>("button:not(:disabled)");
        if (!first) return false;
        first.focus({ preventScroll: true });
        return true;
    }
    function navigateHighlightTools(event: KeyboardEvent & { currentTarget: HTMLButtonElement }): void {
        if (isComposingKey(event) || event.ctrlKey || event.altKey || event.metaKey) return;
        const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!direction) return;
        const buttons = [...(event.currentTarget.closest(".annotation-swatches")?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const index = buttons.indexOf(event.currentTarget);
        if (index < 0) return;
        event.preventDefault();
        buttons[(index + direction + buttons.length) % buttons.length].focus({ preventScroll: true });
    }

    async function selectHighlight(id: string): Promise<void> {
        const item = annotations.find(annotation => annotation.id === id);
        if (!item || id === editorId) return;
        if (editorId && !await closeAnnotation()) return;
        selectedId = id;
        reader?.clearSelection();
        openAnnotation(id, item);
    }

    async function selectFromList(item: PaperAnnotation, at?: Point): Promise<void> {
        if (editorId && !await closeAnnotation()) return;
        setToolsOpen(false);
        selectedId = item.id;
        reader?.clearSelection();
        reader?.goToHighlight(item);
        if (at) openAnnotation(item.id, item);
    }

    async function annotate(color: keyof typeof annotationColors): Promise<void> {
        if (locked || busy) return;
        const input = selection;
        if (!input) return;
        busy = true;
        try {
            if (!await window.api.papers.prepareAnnotation(page.id, input)) return;
            const id = await write(() => window.api.papers.annotate(page.id, input, session.source, color));
            if (!id || input.fileId !== fileId) return;
            selectedId = id;
            reader?.clearSelection();
            openAnnotation(id, input);
        }
        catch (problem) {
            knowledgeState.error = failure(problem);
        }
        finally {
            busy = false;
        }
    }

    function recolor(id: string, color: string): void {
        if (!locked && !busy) void perform(async () => {
            await write(() => window.api.papers.changeAnnotation(id, color, session.source));
        });
    }

    function remove(id: string): void {
        if (!locked && !busy) void perform(async () => {
            busy = true;
            try {
                await write(async () => {
                    if (!await confirmed(token => window.api.papers.deleteAnnotation(id, session.source, token))) return;
                    if (editorId === id) forgetAnnotation();
                    if (selectedId === id) resetSelection();
                });
            }
            finally {
                busy = false;
            }
        });
    }

    async function attach(paths?: string[]): Promise<void> {
        if (locked || busy) return;
        busy = true;
        try {
            await perform(() => importPapers(session.source, { pageId: page.id, paths }));
        }
        finally {
            busy = false;
        }
    }
    function dragOver(event: DragEvent): void {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        dropping = !locked && !busy;
        event.dataTransfer.dropEffect = dropping ? "copy" : "none";
    }
    function dropFiles(event: DragEvent): void {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        dropping = false;
        if (event.dataTransfer.files.length) void attach(Array.from(event.dataTransfer.files, file => window.getPathForFile(file)));
    }
</script>

<div class="paper-panel" bind:clientWidth={width}>
    <div class="pdf-area" class:dropping role="region" aria-label={t("reader.pdf")}
        ondragover={dragOver} ondrop={dropFiles} ondragleave={event => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) dropping = false;
        }}>
        {#if pdfs.length}
            <Reader bind:this={reader} {source} {fileId} {viewState} {annotations} highlightId={selectedId}
                {anchor} onAnchorChange={value => measuredAnchor = value} {focusSelectionTools} onSelection={selectText} onHighlight={selectHighlight}
                onViewStateChange={savePosition} onPasswordAccepted={unlock}
                error={fileError || undefined} onretry={() => void openFile(fileId)}>
                {#snippet toolbarExtra()}
                    {#if pdfs.length > 1}
                        <div class="pdf-select">
                            <Select label={t("reader.pdfFile")} value={fileId}
                                options={pdfs.map(file => ({ value: file.id, label: file.originalName }))}
                                onchange={id => {
                                    if (id && id !== fileId) {
                                        onparams({ ...params, fileId: id });
                                        void openFile(id);
                                    }
                                }} />
                        </div>
                    {/if}
                {/snippet}
            </Reader>
        {:else if fileError}
            <div class="empty-pdf"><div data-paragraph role="alert">{message(fileError)}</div><Button onclick={() => void loadFiles(JSON.parse(filesKey) as string[])}>{t("dialog.retry")}</Button></div>
        {:else}
            <div class="empty-pdf">
                <div data-paragraph>{t(loadingFiles ? "reader.loading" : "reader.noPdf")}</div>
                {#if !loadingFiles && !locked}<Button icon="add" disabled={busy} onclick={() => void attach()}>{t("reader.addPdf")}</Button>{/if}
            </div>
        {/if}
    </div>
    {#if sidebar}
        <div class="paper-sash">
            <Resizer direction="vertical" label={t("library.panelWidth")} origin={width - paneWidth} min={364} max={Math.max(364, width - 240)}
                changeCB={position => onparams({ ...params, infoWidth: Math.round(width - position) })} overflowMargin={20}
                onMaxExceeded={() => onparams({ ...params, showProperties: false })} />
        </div>
        <aside class="paper-sidebar" style:--paper-sidebar-width={params.infoWidth === undefined ? "calc(100% / 3)" : params.infoWidth + "px"}
            aria-label={t("editor.properties")}>
            <Tabs.Root class="paper-sidebar-tabs" value={sidebarTab} onValueChange={value => {
                if (value === "info" || value === "annotations") onparams({ ...params, paperSidebar: value });
            }}>
                <Tabs.List class="paper-sidebar-tabs-list" aria-label={t("editor.properties")}>
                    <Tabs.Trigger class="ui-control" value="info">{t("reader.info")}</Tabs.Trigger>
                    <Tabs.Trigger class="ui-control" value="annotations">{t("reader.annotations")}</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content class="paper-sidebar-content" value="info" bind:ref={infoPanel} inert={syncing}>
                    <PageInformation {tabId} pageId={page.id} />
                </Tabs.Content>
                <Tabs.Content class="paper-sidebar-content annotations" value="annotations">
                    {#if annotationError}<div data-paragraph class="annotation-error" role="alert">{message(annotationError)}
                        <Button onclick={() => void loadAnnotations(fileId)}>{t("dialog.retry")}</Button></div>{/if}
                    <AnnotationList items={annotations} {selectedId} readOnly={locked} visible={visible && sidebarTab === "annotations"}
                        onselect={selectFromList} oncolor={recolor} onremove={remove} onopen={id => openPage(id, { currentGroup: true })} />
                </Tabs.Content>
            </Tabs.Root>
        </aside>
    {/if}
</div>

{#snippet swatches(active: string | undefined, choose: (color: keyof typeof annotationColors) => void, disabled: boolean)}
    <div class="annotation-swatches">
        {#each colors as [id, color] (id)}
            <Tooltip text={t(`color.${id}`)}>
                {#snippet trigger({ props })}
                    <Button {...props} class="swatch-button" variant="text" aria-label={t("reader.highlightColor", { color: t(`color.${id}`) })}
                        {disabled} onkeydown={navigateHighlightTools} onclick={() => choose(id)}>
                        <span class="color-swatch" class:active={active === id} style:background={color.value}></span>
                    </Button>
                {/snippet}
            </Tooltip>
        {/each}
    </div>
{/snippet}

{#if visible && !locked && toolsOpen && selection && !editorId}
    <div class="highlight-tools ui-popup ui-popover" role="dialog" aria-label={t("reader.highlightActions")}
        bind:this={highlightTools} bind:offsetWidth={paletteWidth} bind:offsetHeight={paletteHeight}
        style:left={palette && palette.x + "px"} style:top={palette && palette.y + "px"}
        style:clip-path={palette?.clip} style:visibility={palette?.visible ? "visible" : "hidden"}
        inert={!palette?.visible} popover="manual" {@attach mountPalette}>
        {@render swatches(undefined, color => void annotate(color), busy)}
    </div>
{/if}
{#if opened}
    {#key opened}
        {@const note = opened}
        <AnnotationPopover bind:this={annotationPopup} source={session.source} pageId={note.id} {tabId} {geometry} position={note.position}
            {visible} readOnly={locked} retain={() => retainAnnotation(note)} onmove={position => note.position = position}
            focusOnOpen={tabState.groups.some(group => group.id === tabState.focusedGroupId && group.activeTabId === tabId)}
            restoreFocus={() => reader?.focusViewer()} onclose={() => {
                if (opened === note) forgetAnnotation();
            }}>
            {#snippet actions(readOnly)}
                {@render swatches(annotations.find(item => item.id === note.id)?.color, color => recolor(note.id, color), readOnly || busy)}
                <IconButton icon="trash" label={t("reader.deleteAnnotation")} disabled={readOnly || busy} onclick={() => remove(note.id)} />
            {/snippet}
        </AnnotationPopover>
    {/key}
{/if}

<style>
    .paper-panel { display: flex; flex: 1; min-height: 0; min-width: 0; }
    .pdf-area { display: flex; position: relative; flex: 1; min-width: 0; min-height: 0; background: var(--ui-surface-panel); }
    .pdf-area.dropping::after { content: ""; position: absolute; inset: 0; border: var(--ui-active-border) solid var(--ui-accent); pointer-events: none; }
    .pdf-select { min-width: 0; max-width: 220px; }
    .pdf-select :global(.ui-select) { max-width: 100%; }
    .empty-pdf { margin: auto; display: grid; justify-items: center; gap: var(--ui-space-3); padding: var(--ui-space-4); color: var(--ui-text-secondary); }
    .empty-pdf :where([data-paragraph]) { margin: 0; }
    .paper-sash { display: flex; flex: none; }
    .paper-sidebar {
        display: flex; flex: none; width: max(240px, min(calc(100% - 364px), var(--paper-sidebar-width)));
        min-height: 0; background: var(--ui-surface-window);
    }
    .paper-sidebar :global(.paper-sidebar-tabs) { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
    .paper-sidebar :global(.paper-sidebar-tabs-list) {
        display: flex; flex: none; min-height: var(--ui-toolbar-height); align-items: center; padding-inline: var(--ui-space-2);
        gap: var(--ui-space-1); border-bottom: var(--ui-stroke) solid var(--ui-divider); background: var(--ui-surface-panel);
    }
    .paper-sidebar :global([data-tabs-trigger][data-state="active"]) { background: var(--ui-selected); }
    .paper-sidebar :global(.paper-sidebar-content) { flex: 1; min-height: 0; min-width: 0; overflow: auto; outline-offset: calc(-1 * var(--ui-focus-width)); }
    .paper-sidebar :global(.paper-sidebar-content:focus-visible) { outline: var(--ui-focus-width) solid var(--ui-focus); }
    .paper-sidebar :global(.paper-sidebar-content.annotations:not([hidden])) { display: flex; flex-direction: column; overflow: hidden; }
    .annotation-error { color: var(--ui-danger); margin: var(--ui-space-3); }
    .highlight-tools { position: fixed; inset: auto; margin: 0; padding: var(--ui-space-1); }
    .annotation-swatches { display: flex; align-items: center; gap: var(--ui-space-1); }
    .annotation-swatches :global(.swatch-button) {
        width: var(--ui-row-height); height: var(--ui-row-height); padding: 0; border: 0; border-radius: 50%;
    }
    .color-swatch { width: var(--ui-icon-small); height: var(--ui-icon-small); border-radius: 50%; }
    .color-swatch.active { outline: var(--ui-stroke) solid var(--ui-text-secondary); outline-offset: var(--ui-stroke); }
    @container (max-width: 639px) {
        .paper-panel { flex-direction: column; }
        .paper-sidebar { width: 100%; height: 40%; min-height: var(--ui-toolbar-height); border-top: var(--ui-stroke) solid var(--ui-divider); }
        .paper-sash { display: none; }
    }
</style>