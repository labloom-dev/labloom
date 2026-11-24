<div class="reader" onkeydown={onkeydown} oncopy={copySelection}>
    <Toolbar
        bind:this={toolbar}
        disabled={status.kind !== "ready" || !!error}
        {pageNumber}
        {pagesCount}
        {scale}
        {scaleValue}
        {findStatus}
        extra={toolbarExtra}
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
    <div class="body">
        <div class="viewer" class:selecting role="region" aria-label={t("reader.pdf")} tabindex="0" bind:this={container} {onwheel}
            onscroll={refreshAnchor} onpointerdown={startSelection} onpointermove={moveSelection} onpointerup={finishSelection}
            onpointercancel={cancelDrag} onlostpointercapture={cancelDrag}>
            <div class="pdfViewer"></div>
        </div>
        {#if problem}
            <div class="overlay">
                <div data-paragraph class="error" role="alert">{message(problem)}</div>
                {#if problem.diagnostic}<details><summary>{t("dialog.details")}</summary><div data-paragraph>{problem.diagnostic}</div></details>{/if}
                <Button onclick={onretry ?? (() => retry++)}>{t("dialog.retry")}</Button>
            </div>
        {:else if status.kind === "empty" || status.kind === "loading"}
            <div class="overlay"><div data-paragraph>{t("reader.loading")}</div></div>
        {:else if status.kind === "password"}
            <form class="overlay" onsubmit={submitPassword}>
                <div data-paragraph class:error={status.incorrect}>
                    {t(status.incorrect ? "failure.pdf-password-incorrect" : "failure.pdf-password-required")}
                </div>
                <Input label={t("dialog.pdfPassword")} type="password" bind:value={password} bind:input={passwordInput}
                    inputProps={{ autocomplete: "off" }} />
                <div class="actions">
                    <Button type="submit" variant="primary" disabled={!password}>{t("dialog.open")}</Button>
                    <Button onclick={cancelPassword}>{t("dialog.cancel")}</Button>
                </div>
            </form>
        {/if}
    </div>
</div>

<style>
    .reader { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; min-width: 0; }
    .body { position: relative; flex: 1; min-height: 0; }
    .viewer { position: absolute; inset: 0; overflow: auto; background: var(--ui-surface-panel); }
    .viewer.selecting { cursor: text; }
    .viewer:focus-visible { outline: none; }
    .viewer :global(.textLayer) { user-select: none; }
    /* pdf.js sizes its canvas to the page content box. */
    .viewer :global(.page) { box-sizing: content-box; }
    .viewer :global(.knowledge-highlights) { position: absolute; inset: 0; pointer-events: none; z-index: 2; mix-blend-mode: multiply; }
    .viewer :global(.knowledge-selection) { position: absolute; inset: 0; pointer-events: none; z-index: 4; mix-blend-mode: multiply; opacity: .7; }
    .viewer :global(.knowledge-highlight) { pointer-events: auto; cursor: pointer; opacity: .45; }
    .viewer :global(.knowledge-highlight[data-selected]) { outline: var(--ui-active-border) solid var(--ui-accent); opacity: 1; }
    .overlay {
        position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: var(--ui-space-3); padding: var(--ui-space-4); margin: 0; overflow: auto;
        background: var(--ui-surface-panel); color: var(--ui-text-secondary); font-size: var(--ui-font-small);
    }
    .overlay :where([data-paragraph]) { margin: 0; max-width: 80%; text-align: center; overflow-wrap: anywhere; }
    .overlay details { max-width: 80%; }
    .error { color: var(--ui-danger); }
    .actions { display: flex; gap: var(--ui-space-3); }
</style>

<script lang="ts">
    import type { FailureInfo } from "../../../shared/failure";
    import { message, t } from "../../i18n.svelte";
    import { onMount, untrack, type Snippet } from "svelte";
    import { isComposingKey } from "../../../shared/content/commands";
    import Button from "../base/Button.svelte";
    import Input from "../base/Input.svelte";
    import Toolbar from "./Toolbar.svelte";
    import { type ReaderAnchor, type ReaderAnchorGeometry, type ReaderFindStatus, type ReaderScale, type ReaderSource, type ReaderViewState } from "./defs";
    import { type PaperAnnotation, type AnnotationInput } from "../../../shared/types/papers";
    import { annotationColors } from "../../../shared/content/annotations";
    import { charactersFromTextContent, extractText, hitTest, lineRange, wordRange, selectionRectangles, PDF_EXTRACTOR_VERSION, type PdfCharacter } from "../../../shared/content/pdf-text";
    import {
        applyViewState, createViewer, FindState, getViewState, hasText, loadDocument, PasswordResponses,
        setDocument, toReaderError, type PageViewport, type PDFDocumentProxy, type Viewer, type ViewerLocation
    } from "./pdfjs";

    type Props = {
        source: ReaderSource | null;
        /** Restored whenever a document finishes loading; later changes are ignored. */
        viewState?: ReaderViewState;
        /** Throttled; also called once more when the document is closed or the reader unmounts. */
        onViewStateChange?: (state: ReaderViewState, source: ReaderSource) => void;
        onError?: (error: FailureInfo) => void;
        onPasswordAccepted?: (password: string) => Promise<void>;
        fileId?: string;
        annotations?: PaperAnnotation[];
        highlightId?: string | null;
        toolbarExtra?: Snippet;
        error?: FailureInfo;
        onretry?: () => void;
        anchor?: ReaderAnchor | null;
        onAnchorChange?: (geometry: ReaderAnchorGeometry | null) => void;
        focusSelectionTools?: () => boolean;
        onSelection?: (selection: AnnotationInput | null) => void;
        onHighlight?: (id: string) => void;
    };

    type Status =
        | { kind: "empty" }
        | { kind: "loading" }
        | { kind: "password"; incorrect: boolean }
        | { kind: "ready" }
        | { kind: "error"; error: FailureInfo };

    const { source, viewState, onViewStateChange, onError, onPasswordAccepted, fileId, annotations = [], highlightId,
        anchor, onAnchorChange, focusSelectionTools, onSelection, onHighlight, toolbarExtra, error, onretry }: Props = $props();

    const viewStateReportDelay = 250;
    const zoomDrawingDelay = 400;
    const fitResizeDelay = 200;
    const selectionHitRadius = 12;
    const selectionThreshold = 5;

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
    let passwordInput = $state<HTMLInputElement>();
    let retry = $state(0);
    const problem = $derived(error ?? (status.kind === "error" ? status.error : undefined));
    const highlightsByPage = $derived.by(() => {
        // This map is built once on each annotation update.
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const pages = new Map<number, PaperAnnotation[]>();
        for (const item of annotations) {
            if (item.fileId !== fileId) continue;
            const group = pages.get(item.pageNumber);
            if (group) group.push(item); else pages.set(item.pageNumber, [item]);
        }
        return pages;
    });

    // Per-document state; reset by `open`.
    let openSource: ReaderSource | null = null;
    let pdfDocument: PDFDocumentProxy | null = null;
    let passwordCallback: ((password: string) => void) | null = null;
    let restoring = false;
    let pendingLocation: ViewerLocation | null = null;
    let reportTimer: ReturnType<typeof setTimeout> | null = null;
    let findQuery = "";
    let textCheck: Promise<boolean> | null = null;
    let acceptedPassword = "";
    let pendingHighlight: PaperAnnotation | null = null;
    let anchorFrame = 0;

    function refreshAnchor(): void {
        if (!anchor || anchorFrame) return;
        anchorFrame = requestAnimationFrame(() => {
            anchorFrame = 0;
            const current = anchor, view = current && pdf?.viewer.getPageView(current.pageNumber - 1);
            if (!current || !view || !container.clientWidth || status.kind !== "ready" || !current.rectangles.length) {
                onAnchorChange?.(null); return;
            }
            const page = view.div.getBoundingClientRect(), bounds = container.getBoundingClientRect();
            let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
            for (const rect of current.rectangles) {
                const [x, y] = view.viewport.convertToViewportPoint(rect.x, rect.y);
                const [r, b] = view.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
                left = Math.min(left, x, r); right = Math.max(right, x, r);
                top = Math.min(top, y, b); bottom = Math.max(bottom, y, b);
            }
            onAnchorChange?.({
                anchor: current,
                target: new DOMRect(page.left + view.div.clientLeft + left, page.top + view.div.clientTop + top, right - left, bottom - top),
                viewport: new DOMRect(bounds.left + container.clientLeft, bounds.top + container.clientTop, container.clientWidth, container.clientHeight)
            });
        });
    }
    $effect(() => {
        const current = anchor;
        void pdf; void status.kind;
        if (current) untrack(refreshAnchor); else untrack(() => onAnchorChange?.(null));
    });

    onMount(() => {
        const created = createViewer(container);
        const { eventBus, viewer } = created;

        eventBus.on("pagesinit", () => {
            if (viewState) applyViewState(viewer, viewState);
            else viewer.currentScaleValue = "auto";
            restoring = false;
            const target = pendingHighlight;
            pendingHighlight = null;
            if (target && target.fileId === fileId) goToHighlight(target);
        });
        eventBus.on("pagechanging", ({ pageNumber: value }: { pageNumber: number }) => {
            pageNumber = value;
        });
        eventBus.on("scalechanging", ({ scale: value }: { scale: number }) => {
            if (value !== scale) clicks.time = -Infinity;
            scale = value;
            scaleValue = viewer.currentScaleValue;
            refreshAnchor();
        });
        eventBus.on("updateviewarea", ({ location }: { location: ViewerLocation }) => {
            if (restoring) return;
            pendingLocation = location;
            reportTimer ??= setTimeout(reportViewState, viewStateReportDelay);
        });
        eventBus.on("updatefindcontrolstate", onFindState);
        eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => {
            void loadCharacters(pageNumber);
            paintHighlights(pageNumber);
            if (selected?.pageNumber === pageNumber) paintSelection();
            if (anchor?.pageNumber === pageNumber) refreshAnchor();
        });
        eventBus.on("rotationchanging", () => {
            repaintRenderedHighlights();
            paintSelection();
            refreshAnchor();
        });
        eventBus.on("updatefindmatchescount", ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
            if (findStatus.kind === "found") findStatus = { ...findStatus, ...matchesCount };
        });

        pdf = created;
        let resizeTimer: ReturnType<typeof setTimeout> | undefined;
        const observeSize = new ResizeObserver(() => {
            refreshAnchor();
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const preset = viewer.currentScaleValue;
                if (pdfDocument && !restoring && (preset === "auto" || preset === "page-width" || preset === "page-fit")) viewer.currentScaleValue = preset;
            }, fitResizeDelay);
        });
        observeSize.observe(container);
        window.addEventListener("workspace-flush", reportViewState);
        return () => {
            clearTimeout(resizeTimer);
            cancelAnimationFrame(anchorFrame);
            observeSize.disconnect();
            window.removeEventListener("workspace-flush", reportViewState);
        };
    });

    $effect(() => {
        void highlightsByPage;
        if (pdf) untrack(repaintRenderedHighlights);
    });
    $effect(() => {
        const id = highlightId;
        container?.querySelectorAll<HTMLElement>(".knowledge-highlight[data-selected]").forEach(mark => delete mark.dataset.selected);
        if (id) container?.querySelectorAll<HTMLElement>(`.knowledge-highlight[data-highlight-id="${CSS.escape(id)}"]`).forEach(mark => mark.dataset.selected = "");
    });
    $effect(() => {
        if (status.kind === "password") passwordInput?.focus();
    });

    // Character geometry lives in PDF user space. DOM text remains for find/accessibility only.
    // Geometry and in-flight requests are read imperatively by pointer handlers.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const characters = new Map<number, PdfCharacter[]>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const pendingCharacters = new Map<number, Promise<void>>();
    type Point = { x: number; y: number };
    type PagePoint = Point & { page: number };
    type SelectionDrag = {
        at: PagePoint; origin: Point; pointer: number; unit: number; active: boolean;
        range?: { start: number; end: number; initial: [number, number] };
        pendingMove?: Point; released?: boolean;
    };
    let drag: SelectionDrag | null = null;
    let selecting = $state(false);
    let selected: AnnotationInput | null = null;
    let clicks = { time: 0, x: 0, y: 0, count: 0 };
    const feedback: number[] = [];
    function afterPaint(callback: () => void): void {
        requestAnimationFrame(() => requestAnimationFrame(callback));
    }
    async function loadCharacters(number: number): Promise<void> {
        const document = pdfDocument;
        if (!document || characters.has(number)) return;
        const prior = pendingCharacters.get(number);
        if (prior) return prior;
        const task = (async () => {
            try {
                const page = await document.getPage(number);
                const content = await page.getTextContent();
                if (pdfDocument === document) characters.set(number, charactersFromTextContent(content));
            }
            catch (error) {
                if (pdfDocument === document) fail(toReaderError(error));
            }
        })();
        pendingCharacters.set(number, task);
        await task;
        if (pdfDocument === document) pendingCharacters.delete(number);
    }
    function point(event: PointerEvent, number?: number): PagePoint | null {
        const page = number ?? Number((event.target as Element)?.closest?.(".page")?.getAttribute("data-page-number"));
        const view = pdf?.viewer.getPageView(page - 1);
        if (!view?.pdfPage) return null;
        const bounds = view.div.getBoundingClientRect();
        // viewport is the content box; page borders are outside its coordinates.
        const [x, y] = view.viewport.convertToPdfPoint(event.clientX - bounds.left - view.div.clientLeft, event.clientY - bounds.top - view.div.clientTop);
        return { page, x, y };
    }
    function nearClick(x: number, y: number): boolean {
        return Math.hypot(x - clicks.x, y - clicks.y) < selectionThreshold;
    }
    function startSelection(event: PointerEvent): void {
        if (event.button !== 0 || !fileId || status.kind !== "ready" || drag && !drag.released) return;
        const target = event.target as Element;
        if (target?.closest?.(".knowledge-highlight")) return;
        const bounds = container.getBoundingClientRect();
        if (event.clientX >= bounds.left + container.clientLeft + container.clientWidth ||
            event.clientY >= bounds.top + container.clientTop + container.clientHeight) return;
        const at = point(event);
        clearSelection();
        if (!at) {
            clicks.time = -Infinity; return;
        }
        const repeated = event.timeStamp - clicks.time < 500 && nearClick(event.clientX, event.clientY);
        const chars = characters.get(at.page);
        const index = chars ? hitTest(chars, at.x, at.y, selectionHitRadius) : -1;
        if (chars && index < 0) {
            clicks.time = -Infinity; return;
        }
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        focusViewer();
        clicks = { time: event.timeStamp, x: event.clientX, y: event.clientY, count: repeated ? clicks.count % 3 + 1 : 1 };
        const next: SelectionDrag = {
            at, origin: { x: event.clientX, y: event.clientY }, unit: clicks.count, pointer: event.pointerId, active: clicks.count > 1
        };
        drag = next;
        container.setPointerCapture(event.pointerId);
        selecting = next.active;
        if (chars) beginRange(next, chars, index);
        else {
            void loadCharacters(at.page).then(() => {
                if (drag !== next) return;
                const loaded = characters.get(at.page);
                const start = loaded ? hitTest(loaded, at.x, at.y, selectionHitRadius) : -1;
                if (!loaded || start < 0) {
                    clearSelection(); return;
                }
                beginRange(next, loaded, start);
                if (next.active && next.pendingMove) extendRange(loaded, next.pendingMove);
                if (next.released) completeSelection();
            });
        }
    }
    function rangeFor(chars: readonly PdfCharacter[], index: number, unit: number): [number, number] {
        return unit === 3 ? lineRange(chars, index) : unit === 2 ? wordRange(chars, index) : [index, index];
    }
    function beginRange(current: SelectionDrag, chars: readonly PdfCharacter[], index: number): void {
        const initial = rangeFor(chars, index, current.unit);
        current.range = { start: initial[0], end: initial[1], initial };
        if (current.active && !current.pendingMove) updateSelection(false);
    }
    function moveSelection(event: PointerEvent): void {
        if (!drag || drag.released || drag.pointer !== event.pointerId) return;
        if (Math.hypot(event.clientX - drag.origin.x, event.clientY - drag.origin.y) < selectionThreshold && !drag.pendingMove) return;
        drag.active = true;
        selecting = true;
        clicks.time = -Infinity;
        const started = event.timeStamp;
        const at = point(event, drag.at.page);
        if (!at) return;
        drag.pendingMove = at;
        if (!drag.range) return;
        extendRange(characters.get(drag.at.page)!, at);
        if (import.meta.env.DEV) afterPaint(() => {
            feedback.push(performance.now() - started);
            if (feedback.length > 512) feedback.shift();
        });
    }
    function extendRange(chars: readonly PdfCharacter[], at: Point): void {
        const current = drag!, range = current.range!;
        const index = hitTest(chars, at.x, at.y, Infinity);
        if (index < 0) return;
        const [start, end] = rangeFor(chars, index, current.unit);
        const backwards = start < range.initial[0];
        range.start = backwards ? range.initial[1] : range.initial[0];
        range.end = backwards ? start : Math.max(range.initial[1], end);
        updateSelection(false);
    }
    function finishSelection(event: PointerEvent): void {
        if (!drag || drag.pointer !== event.pointerId) return;
        const current = drag;
        moveSelection(event);
        current.released = true;
        releaseSelectionPointer(current.pointer);
        if (!current.active) clearSelection();
        else if (current.range) completeSelection();
    }
    function completeSelection(): void {
        updateSelection(true);
        drag = null;
        if (import.meta.env.DEV) afterPaint(() => {
            const sorted = [...feedback].sort((a, b) => a - b);
            if (sorted.length) console.debug("PDF drag feedback", JSON.stringify({ samples: sorted.length, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], characters: characters.get(selected?.pageNumber ?? 0)?.length ?? 0 }));
        });
    }
    function releaseSelectionPointer(pointer: number): void {
        selecting = false;
        if (container.hasPointerCapture(pointer)) container.releasePointerCapture(pointer);
    }
    function cancelDrag(event: PointerEvent): void {
        if (event.type === "lostpointercapture" && event.target !== container) return;
        if (drag?.pointer !== event.pointerId || drag.released) return;
        clearSelection();
    }
    function updateSelection(report: boolean): void {
        if (!drag?.range || !fileId) return;
        const chars = characters.get(drag.at.page) ?? [];
        const rectangles = selectionRectangles(chars, drag.range.start, drag.range.end);
        const quote = extractText(chars, rectangles);
        selected = quote.trim() && rectangles.length ? { fileId, pageNumber: drag.at.page, rectangles, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION } : null;
        paintSelection();
        if (report) onSelection?.(selected);
    }
    export function clearSelection(): void {
        const current = drag;
        selected = null;
        drag = null;
        if (current) releaseSelectionPointer(current.pointer);
        onSelection?.(null);
        paintSelection();
    }
    export function focusViewer(): void {
        container?.focus({ preventScroll: true });
    }
    function copySelection(event: ClipboardEvent): void {
        if (!selected || (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable=true]"))) return;
        event.preventDefault();
        // Use exactly the same rectangle rule as the persisted cache.
        event.clipboardData?.setData("text/plain", extractText(characters.get(selected.pageNumber) ?? [], selected.rectangles));
    }
    function drawRectangle(layer: HTMLElement, rect: PaperAnnotation["rectangles"][number], viewport: PageViewport, color: string): HTMLElement {
        const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y);
        const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
        const mark = document.createElement("span");
        Object.assign(mark.style, {
            position: "absolute", backgroundColor: color,
            left: `${Math.min(x1, x2) / viewport.width * 100}%`, top: `${Math.min(y1, y2) / viewport.height * 100}%`,
            width: `${Math.abs(x2 - x1) / viewport.width * 100}%`, height: `${Math.abs(y2 - y1) / viewport.height * 100}%`
        });
        layer.appendChild(mark);
        return mark;
    }
    function paintSelection(): void {
        container?.querySelectorAll(".knowledge-selection").forEach(layer => layer.remove());
        if (!selected) return;
        const view = pdf?.viewer.getPageView(selected.pageNumber - 1);
        const canvas = view?.div.querySelector(":scope > .canvasWrapper");
        if (!canvas) return;
        const layer = document.createElement("div");
        layer.className = "knowledge-selection";
        for (const rect of selected.rectangles) drawRectangle(layer, rect, view.viewport, "var(--ui-text-selection)");
        canvas.appendChild(layer);
    }

    function repaintRenderedHighlights(): void {
        for (const page of container.querySelectorAll<HTMLElement>(".pdfViewer > .page:has(> .canvasWrapper)"))
            paintHighlights(Number(page.dataset.pageNumber), true);
    }
    function paintHighlights(number: number, repaint = false): void {
        const view = pdf?.viewer.getPageView(number - 1);
        // PDF.js retains the canvas wrapper on zoom, while the positioned page anchors the overlays.
        const canvas = view?.div.querySelector(":scope > .canvasWrapper");
        if (!canvas) return;
        const previous = canvas.querySelector(":scope > .knowledge-highlights");
        if (previous && !repaint) return;
        previous?.remove();
        const items = highlightsByPage.get(number);
        if (!items?.length) return;
        const viewport: PageViewport = view.viewport;
        const layer = document.createElement("div");
        layer.className = "knowledge-highlights";
        for (const anchor of items) {
            for (const rect of anchor.rectangles) {
                const mark = drawRectangle(layer, rect, viewport, annotationColors[anchor.color].value);
                mark.className = "knowledge-highlight";
                mark.dataset.highlightId = anchor.id;
                if (anchor.id === highlightId) mark.dataset.selected = "";
                mark.onclick = event => {
                    event.stopPropagation();
                    clicks.time = -Infinity;
                    focusViewer();
                    onHighlight?.(anchor.id);
                };
            }
        }
        canvas.appendChild(layer);
    }

    $effect(() => {
        const current = source;
        const viewer = pdf;
        void retry;
        if (!viewer) return;
        return untrack(() => open(viewer, current));
    });

    function open(viewer: Viewer, current: ReaderSource | null): (() => void) | undefined {
        acceptedPassword = "";
        feedback.length = 0;
        characters.clear();
        pendingCharacters.clear();
        clearSelection();
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
            async loaded => {
                if (closed) return;
                if (acceptedPassword && onPasswordAccepted) {
                    try {
                        await onPasswordAccepted(acceptedPassword);
                    }
                    catch (error) {
                        fail(toReaderError(error)); return;
                    }
                    finally {
                        acceptedPassword = "";
                    }
                    if (closed) return;
                }
                pdfDocument = loaded;
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

    function fail(error: FailureInfo): void {
        status = { kind: "error", error };
        onError?.(error);
    }

    function submitPassword(event: SubmitEvent): void {
        event.preventDefault();
        const callback = passwordCallback;
        if (!callback || !password) return;
        passwordCallback = null;
        status = { kind: "loading" };
        acceptedPassword = password;
        callback(password);
        // Not kept here; pdf.js holds it only while this document is open.
        password = "";
    }

    function cancelPassword(): void {
        passwordCallback = null;
        password = "";
        fail({ kind: "pdf-password-cancelled" });
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
            drawingDelay: zoomDrawingDelay,
            // One wheel notch (100px) is one zoom step, while touchpad pinches zoom smoothly.
            scaleFactor: 1.1 ** (-event.deltaY / 100),
            origin: [event.clientX - rect.left, event.clientY - rect.top]
        });
    }

    function onkeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event)) return;
        if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey &&
            event.target === container && focusSelectionTools?.()) {
            event.preventDefault();
            return;
        }
        if (event.key === "Escape") clearSelection();
        if (!(event.ctrlKey || event.metaKey)) return;
        if (event.key.toLowerCase() === "f") {
            event.preventDefault();
            toolbar?.focusSearch();
        }
        if (!pdf || status.kind !== "ready" || error || event.altKey) return;
        if (event.key === "+" || event.key === "=" || event.key === "-") {
            event.preventDefault();
            pdf.viewer.updateScale({ steps: event.key === "-" ? -1 : 1, drawingDelay: zoomDrawingDelay });
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

    export function goToHighlight(item: PaperAnnotation): void {
        if (item.fileId !== fileId || !item.rectangles.length) return;
        const view = pdf?.viewer.getPageView(item.pageNumber - 1);
        if (!pdf || !view || restoring) {
            pendingHighlight = item;
            return;
        }
        const rect = item.rectangles[0], x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        const [left, top] = view.viewport.convertToViewportPoint(x, y);
        const page = view.div.getBoundingClientRect(), viewport = container.getBoundingClientRect();
        if (page.left + left >= viewport.left && page.left + left <= viewport.right && page.top + top >= viewport.top && page.top + top <= viewport.bottom) return;
        pdf.viewer.scrollPageIntoView({ pageNumber: item.pageNumber, destArray: [null, { name: "XYZ" }, x, y, null], center: "both" });
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