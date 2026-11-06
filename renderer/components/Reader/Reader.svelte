<div class="reader" onkeydown={onkeydown}>
    <Toolbar
        bind:this={toolbar}
        disabled={status.kind !== "ready"}
        {pageNumber}
        {pagesCount}
        {scale}
        {scaleValue}
        {findStatus}
        query={searchQuery}
        {goToPage}
        previousPage={() => pdf?.viewer.previousPage()}
        nextPage={() => pdf?.viewer.nextPage()}
        zoomIn={() => pdf?.viewer.increaseScale()}
        zoomOut={() => pdf?.viewer.decreaseScale()}
        {setScale}
        {rotate}
        {find}
        {clearFind}
    />
    {#if onAnnotate}
        <div class="annotation-tools"><select aria-label="标注颜色" bind:value={annotationColor}><option value="yellow">奶油黄</option><option value="green">嫩叶绿</option><option value="blue">天空蓝</option><option value="pink">樱花粉</option></select><button disabled={status.kind !== "ready" || !selection.length || marking} onclick={highlightSelection}>高亮选中文字</button><button class:active={areaMode} disabled={status.kind !== "ready" || marking} onclick={() => { areaMode = !areaMode; }}>框选区域</button><span>{marking ? "正在保存标注…" : areaMode ? "在页面上拖动选择区域，Esc 取消" : "选择文字后添加高亮，点击高亮打开批注"}</span></div>
        {#if annotationError}<p class="annotation-error" role="alert">{annotationError}</p>{/if}
    {/if}
    <div class="body">
        <div class="viewer" class:area-mode={areaMode} tabindex="-1" bind:this={container} {onwheel} onmouseup={captureSelection} onpointerdown={startArea} onpointerup={finishArea}>
            <div class="pdfViewer"></div>
        </div>
        {#if status.kind === "empty"}
            <div class="overlay">
                <div class="reader-art"><Bloom /></div>
                <strong>读一页，也是一点收获。</strong>
                <p>点击上方“打开本地 PDF”，开始阅读。</p>
            </div>
        {:else if status.kind === "loading"}
            <div class="overlay">
                <p>正在加载…</p>
            </div>
        {:else if status.kind === "password"}
            <form class="overlay" onsubmit={submitPassword}>
                <p class:error={status.incorrect}>
                    {status.incorrect ? "密码错误，请重新输入。" : "此 PDF 受密码保护，请输入密码。"}
                </p>
                <input type="password" autocomplete="off" bind:value={password} {@attach element => element.focus()} />
                <div class="actions">
                    <button type="submit" class="primary" disabled={!password}>打开</button>
                    <button type="button" onclick={cancelPassword}>取消</button>
                </div>
            </form>
        {:else if status.kind === "error"}
            <div class="overlay">
                <p class="error">{status.error.message}</p>
            </div>
        {/if}
    </div>
</div>


<style>
    .reader {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
    }
    .body {
        position: relative;
        flex: 1;
        min-height: 0;
    }
    .viewer {
        position: absolute;
        inset: 0;
        overflow: auto;
        background-color: var(--c-reader-background);
    }
    .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin: 0;
        background-color: var(--c-reader-background);
        color: var(--c-reader-muted-text);
        font-size: 14px;
    }
    .reader-art {
        width: 150px;
    }
    .overlay strong {
        color: var(--c-ink);
        font-size: 17px;
    }
    .overlay p {
        margin: 0;
        max-width: 80%;
        text-align: center;
    }
    .error {
        color: var(--c-reader-error-text);
    }
    .overlay input {
        width: 240px;
        height: 28px;
        padding-inline: 8px;
        border: var(--border-width) solid var(--c-reader-input-border);
        border-radius: 6px;
        font: inherit;
    }
    .overlay input:focus-visible {
        outline: var(--focus-width) solid var(--c-border-focus);
    }
    .actions {
        display: flex;
        gap: 8px;
    }
    .actions button {
        padding: 4px 16px;
        border: var(--border-width) solid var(--c-reader-input-border);
        border-radius: 6px;
        background-color: var(--c-surface);
        font: inherit;
    }
    .actions button.primary {
        border-color: var(--c-accent);
        background-color: var(--c-accent);
        color: var(--c-surface);
    }
    .actions button:disabled {
        cursor: default;
        opacity: .5;
    }
    .annotation-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; padding: 8px 12px; border-bottom: 1px solid var(--c-line); background: var(--c-paper); font-size: 10px; }
    .annotation-tools select, .annotation-tools button { padding: 5px 8px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); font: inherit; }
    .annotation-tools button.active { background: var(--c-gold-light); border-color: var(--c-ink); }
    .annotation-tools span { color: var(--c-muted); }
    .annotation-error { margin: 0; padding: 7px 12px; color: var(--c-error); font-size: 11px; }
    .area-mode { cursor: crosshair; user-select: none; }
    :global(.labloom-annotations) { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
    :global(.labloom-highlight) { position: absolute; padding: 0; border: 0; border-radius: 2px; pointer-events: auto; mix-blend-mode: multiply; opacity: .36; cursor: pointer; }
    :global(.labloom-highlight:focus-visible) { outline: 2px solid #67542d; opacity: .7; }
    .area-mode :global(.labloom-highlight) { pointer-events: none; }
</style>


<script lang="ts">
    import { onMount, untrack } from "svelte";
    import Bloom from "../utils/Bloom.svelte";
    import Toolbar from "./Toolbar.svelte";
    import type { Annotation } from "../../../shared/types/knowledge";
    import type { ReaderError, ReaderFindStatus, ReaderScale, ReaderSource, ReaderViewState } from "./defs";
    import {
        applyViewState, createViewer, FindState, getViewState, hasText, loadDocument, PasswordResponses,
        setDocument, toReaderError, type PDFDocumentProxy, type Viewer, type ViewerLocation
    } from "./pdfjs";

    type Props = {
        source: ReaderSource | null;
        /** Restored whenever a document finishes loading; later changes are ignored. */
        viewState?: ReaderViewState;
        /** Throttled; also called once more when the document is closed or the reader unmounts. */
        onViewStateChange?: (state: ReaderViewState, source: ReaderSource) => void;
        onError?: (error: ReaderError) => void;
        onMetadata?: (info: { title: string; authors: string }) => void;
        annotations?: Annotation[];
        onAnnotate?: (input: Pick<Annotation, "pageNumber" | "quote" | "rects" | "color">) => Promise<void>;
        onOpenAnnotation?: (annotation: Annotation) => void;
    };

    type Status =
        | { kind: "empty" }
        | { kind: "loading" }
        | { kind: "password"; incorrect: boolean }
        | { kind: "ready" }
        | { kind: "error"; error: ReaderError };

    const { source, viewState, onViewStateChange, onError, onMetadata, annotations = [], onAnnotate, onOpenAnnotation }: Props = $props();

    let annotationColor = $state("yellow");
    let areaMode = $state(false);
    let marking = $state(false);
    let annotationError = $state("");
    let selection = $state<Pick<Annotation, "pageNumber" | "quote" | "rects">[]>([]);
    let areaStart: { x: number; y: number; page: HTMLElement } | null = null;
    const colors: Record<string, string> = { yellow: "#f6cd49", green: "#9ec57d", blue: "#83b9ef", pink: "#ec9fc2" };
    $effect(() => { annotations; pdf; untrack(() => queueMicrotask(drawAnnotations)); });

    function drawAnnotations(): void {
        if (!pdf || !container) return;
        container.querySelectorAll(".labloom-annotations").forEach(element => element.remove());
        for (const annotation of annotations) {
            const page = pdf.viewer.getPageView(annotation.pageNumber - 1);
            if (!page?.div || !page.viewport) continue;
            let layer = (page.div as HTMLDivElement).querySelector<HTMLDivElement>(".labloom-annotations");
            if (!layer) { layer = document.createElement("div"); layer.className = "labloom-annotations"; page.div.append(layer); }
            for (const rect of annotation.rects) {
                const points = [...page.viewport.convertToViewportPoint(rect.x, rect.y), ...page.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)];
                const button = document.createElement("button");
                button.className = "labloom-highlight";
                button.title = annotation.quote || `第 ${annotation.pageNumber} 页批注`;
                button.setAttribute("aria-label", `打开批注：${button.title}`);
                Object.assign(button.style, { left: `${Math.min(points[0], points[2])}px`, top: `${Math.min(points[1], points[3])}px`, width: `${Math.abs(points[2] - points[0])}px`, height: `${Math.abs(points[3] - points[1])}px`, backgroundColor: colors[annotation.color] ?? colors.yellow });
                button.onclick = () => onOpenAnnotation?.(annotation);
                layer.append(button);
            }
        }
    }
    function pdfRect(pageElement: HTMLElement, rect: { left: number; top: number; right: number; bottom: number }): Annotation["rects"][number] | null {
        const number = Number(pageElement.dataset.pageNumber);
        const page = pdf?.viewer.getPageView(number - 1);
        if (!page?.viewport) return null;
        const bounds = pageElement.getBoundingClientRect();
        const left = Math.max(bounds.left, rect.left), top = Math.max(bounds.top, rect.top);
        const right = Math.min(bounds.right, rect.right), bottom = Math.min(bounds.bottom, rect.bottom);
        if (right - left < 2 || bottom - top < 2) return null;
        const a = page.viewport.convertToPdfPoint(left - bounds.left, top - bounds.top);
        const b = page.viewport.convertToPdfPoint(right - bounds.left, bottom - bounds.top);
        return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
    }
    function captureSelection(): void {
        if (!onAnnotate || areaMode || marking) return;
        const selected = window.getSelection();
        if (!selected || selected.isCollapsed || !selected.rangeCount || !container.contains(selected.anchorNode) || !container.contains(selected.focusNode)) { selection = []; return; }
        const range = selected.getRangeAt(0);
        const quote = selected.toString().trim().slice(0, 10000);
        const parts: typeof selection = [];
        for (const element of container.querySelectorAll<HTMLElement>(".page")) {
            if (!range.intersectsNode(element)) continue;
            const rects = Array.from(range.getClientRects()).map(rect => pdfRect(element, rect)).filter((rect): rect is Annotation["rects"][number] => !!rect).slice(0, 200);
            if (rects.length) parts.push({ pageNumber: Number(element.dataset.pageNumber), quote, rects });
        }
        selection = parts;
    }
    function startArea(event: PointerEvent): void {
        if (!areaMode || event.button !== 0) return;
        const page = (event.target as Element).closest<HTMLElement>(".page");
        if (page) { event.preventDefault(); areaStart = { x: event.clientX, y: event.clientY, page }; container.setPointerCapture(event.pointerId); }
    }
    function finishArea(event: PointerEvent): void {
        if (!areaStart) return;
        const start = areaStart; areaStart = null;
        if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
        const rect = pdfRect(start.page, { left: Math.min(start.x, event.clientX), top: Math.min(start.y, event.clientY), right: Math.max(start.x, event.clientX), bottom: Math.max(start.y, event.clientY) });
        if (rect) { selection = [{ pageNumber: Number(start.page.dataset.pageNumber), quote: "", rects: [rect] }]; void highlightSelection(); }
        areaMode = false;
    }
    async function highlightSelection(): Promise<void> {
        if (!onAnnotate || marking) return;
        marking = true; annotationError = "";
        try { for (const item of selection) await onAnnotate({ ...$state.snapshot(item), color: annotationColor }); selection = []; window.getSelection()?.removeAllRanges(); }
        catch (error) { annotationError = error instanceof Error ? error.message : "标注保存失败。"; }
        finally { marking = false; }
    }

    const viewStateReportDelay = 250;

    let container: HTMLDivElement;
    let toolbar = $state<Toolbar | null>(null);
    let pdf = $state.raw<Viewer | null>(null);

    let status = $state<Status>({ kind: "empty" });
    let pageNumber = $state(1);
    let pagesCount = $state(0);
    let scale = $state(1);
    let scaleValue = $state("auto");
    let findStatus = $state<ReaderFindStatus>({ kind: "idle" });
    let searchQuery = $state("");
    let password = $state("");

    // Per-document state; reset by `open`.
    let openSource: ReaderSource | null = null;
    let pdfDocument: PDFDocumentProxy | null = null;
    let passwordCallback: ((password: string) => void) | null = null;
    let restoring = false;
    let pendingLocation: ViewerLocation | null = null;
    let reportTimer: ReturnType<typeof setTimeout> | null = null;
    let findQuery = "";
    let textCheck: Promise<boolean> | null = null;

    onMount(() => {
        const created = createViewer(container);
        const { eventBus, viewer } = created;

        eventBus.on("pagesinit", () => {
            if (viewState) applyViewState(viewer, viewState);
            else viewer.currentScaleValue = "auto";
            restoring = false;
        });
        eventBus.on("pagechanging", ({ pageNumber: value }: { pageNumber: number }) => {
            pageNumber = value;
        });
        eventBus.on("scalechanging", ({ scale: value }: { scale: number }) => {
            scale = value;
            scaleValue = viewer.currentScaleValue;
        });
        eventBus.on("updateviewarea", ({ location }: { location: ViewerLocation }) => {
            if (restoring) return;
            pendingLocation = location;
            reportTimer ??= setTimeout(reportViewState, viewStateReportDelay);
        });
        eventBus.on("updatefindcontrolstate", onFindState);
        eventBus.on("updatefindmatchescount", ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
            if (findStatus.kind === "found") findStatus = { ...findStatus, ...matchesCount };
        });

        eventBus.on("pagerendered", drawAnnotations);
        eventBus.on("scalechanging", () => queueMicrotask(drawAnnotations));
        eventBus.on("rotationchanging", () => queueMicrotask(drawAnnotations));
        pdf = created;
    });

    $effect(() => {
        const current = source;
        const viewer = pdf;
        if (!viewer) return;
        return untrack(() => open(viewer, current));
    });

    function open(viewer: Viewer, current: ReaderSource | null): (() => void) | undefined {
        selection = []; areaMode = false; annotationError = "";
        pageNumber = 1;
        pagesCount = 0;
        findStatus = { kind: "idle" };
        searchQuery = "";
        findQuery = "";
        textCheck = null;
        openSource = current;
        if (!current) {
            status = { kind: "empty" };
            return;
        }

        status = { kind: "loading" };
        let closed = false;
        const task = loadDocument(current.data);
        task.onPassword = (update: (password: string) => void, reason: number) => {
            if (closed) return;
            passwordCallback = update;
            status = { kind: "password", incorrect: reason === PasswordResponses.INCORRECT_PASSWORD };
        };
        task.promise.then(
            loaded => {
                if (closed) return;
                pdfDocument = loaded;
                if (onMetadata) void loaded.getMetadata().then(metadata => {
                    const info = metadata.info as { Title?: unknown; Author?: unknown };
                    if (!closed) onMetadata({ title: typeof info.Title === "string" ? info.Title.trim().slice(0, 500) : "", authors: typeof info.Author === "string" ? info.Author.trim().slice(0, 10000) : "" });
                }).catch(() => { /* A PDF without readable metadata remains usable. */ });
                pagesCount = loaded.numPages;
                restoring = true;
                setDocument(viewer, loaded);
                status = { kind: "ready" };
            },
            (error: unknown) => {
                if (!closed) fail(toReaderError(error));
            }
        );

        return () => {
            closed = true;
            reportViewState();
            openSource = null;
            pdfDocument = null;
            passwordCallback = null;
            password = "";
            setDocument(viewer, null);
            void task.destroy();
        };
    }

    function fail(error: ReaderError): void {
        status = { kind: "error", error };
        onError?.(error);
    }

    function submitPassword(event: SubmitEvent): void {
        event.preventDefault();
        const callback = passwordCallback;
        if (!callback || !password) return;
        passwordCallback = null;
        status = { kind: "loading" };
        callback(password);
        // Not kept here; pdf.js holds it only while this document is open.
        password = "";
    }

    function cancelPassword(): void {
        passwordCallback = null;
        password = "";
        fail({ kind: "password-cancelled", message: "已取消打开：此 PDF 需要密码。" });
    }

    function reportViewState(): void {
        if (reportTimer !== null) clearTimeout(reportTimer);
        reportTimer = null;
        const location = pendingLocation;
        pendingLocation = null;
        if (location && pdf && openSource) onViewStateChange?.(getViewState(pdf.viewer, location), openSource);
    }

    function onwheel(event: WheelEvent): void {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        if (!pdf || status.kind !== "ready") return;
        const rect = container.getBoundingClientRect();
        pdf.viewer.updateScale({
            drawingDelay: 400,
            // One wheel notch (100px) is one zoom step, while touchpad pinches zoom smoothly.
            scaleFactor: 1.1 ** (-event.deltaY / 100),
            origin: [event.clientX - rect.left, event.clientY - rect.top]
        });
    }

    function onkeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") { areaMode = false; areaStart = null; }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            toolbar?.focusSearch();
        }
    }

    function onFindState({ state, matchesCount, rawQuery }: {
        state: number;
        matchesCount: { current: number; total: number };
        rawQuery: string | null;
    }): void {
        if (rawQuery !== findQuery || !findQuery) return;
        if (state === FindState.PENDING) {
            findStatus = { kind: "pending" };
        }
        else if (state === FindState.FOUND || state === FindState.WRAPPED) {
            findStatus = { kind: "found", ...matchesCount, wrapped: state === FindState.WRAPPED };
        }
        else {
            const query = findQuery;
            const loaded = pdfDocument;
            if (!loaded) return;
            textCheck ??= hasText(loaded);
            findStatus = { kind: "pending" };
            void textCheck.then(found => {
                if (query === findQuery && loaded === pdfDocument) {
                    findStatus = { kind: found ? "not-found" : "no-text" };
                }
            });
        }
    }

    /** Opens the page, clamped to the document. */
    export function goToPage(value: number): void {
        if (!pdf || status.kind !== "ready") return;
        pdf.viewer.currentPageNumber = Math.min(Math.max(1, Math.round(value)), pagesCount);
    }

    export function setScale(value: ReaderScale): void {
        if (!pdf || status.kind !== "ready") return;
        pdf.viewer.currentScaleValue = String(value);
    }

    export function rotate(): void {
        if (!pdf || status.kind !== "ready") return;
        pdf.viewer.pagesRotation = (pdf.viewer.pagesRotation + 90) % 360;
    }

    /**
     * Highlights every match and scrolls to the next one, or the previous one.
     * Repeating the last query moves on from the current match.
     */
    export function find(query: string, previous = false): void {
        if (!pdf || status.kind !== "ready") return;
        searchQuery = query;
        if (!query) {
            clearFind();
            return;
        }
        const again = query === findQuery;
        findQuery = query;
        pdf.eventBus.dispatch("find", {
            source: null,
            type: again ? "again" : "",
            query,
            caseSensitive: false,
            entireWord: false,
            highlightAll: true,
            findPrevious: previous,
            matchDiacritics: false
        });
    }

    export function clearFind(): void {
        searchQuery = "";
        findQuery = "";
        findStatus = { kind: "idle" };
        pdf?.eventBus.dispatch("findbarclose", { source: null });
    }
</script>