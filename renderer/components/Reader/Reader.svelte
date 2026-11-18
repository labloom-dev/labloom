<div class="reader" onkeydown={onkeydown} oncopy={copySelection}>
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
    <div class="body">
        <div class="viewer" tabindex="-1" bind:this={container} {onwheel} onpointerdown={startSelection} onpointermove={moveSelection} onpointerup={finishSelection} onpointercancel={cancelDrag}>
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
                    {t(status.incorrect ? "failure.pdf-password-incorrect" : "failure.pdf-password-required")}
                </p>
                <input aria-label={t("dialog.pdfPassword")} type="password" autocomplete="off" bind:value={password} {@attach element => element.focus()} />
                <div class="actions">
                    <button type="submit" class="primary" disabled={!password}>{t("dialog.open")}</button>
                    <button type="button" onclick={cancelPassword}>{t("dialog.cancel")}</button>
                </div>
            </form>
        {:else if status.kind === "error"}
            <div class="overlay">
                <p class="error">{message(status.error)}</p>
                {#if status.error.diagnostic}<details><summary>{t("dialog.details")}</summary><p>{status.error.diagnostic}</p></details>{/if}
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
    .viewer :global(.textLayer) { user-select: none; }
    /* pdf.js sizes its canvas to the page content box; the app's global border-box
       rule would shrink the drawing while viewport coordinates stay unchanged. */
    .viewer :global(.page) { box-sizing: content-box; }
    .viewer :global(.knowledge-highlights) { mix-blend-mode: multiply; }
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
</style>


<script lang="ts">
    import { message, t } from "../../i18n.svelte";
    import { onMount, untrack } from "svelte";
    import Bloom from "../utils/Bloom.svelte";
    import Toolbar from "./Toolbar.svelte";
    import type { ReaderError, ReaderFindStatus, ReaderScale, ReaderSource, ReaderViewState } from "./defs";
    import { type PaperAnnotation, type AnnotationInput } from "../../../shared/types/papers";
    import { annotationColors } from "../../../shared/content/annotations";
    import { charactersFromTextContent, extractText, hitTest, lineRange, wordRange, selectionRectangles, PDF_EXTRACTOR_VERSION, type PdfCharacter } from "../../../shared/content/pdf-text";
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
        onPasswordAccepted?: (password: string) => Promise<void>;
        fileId?: string;
        annotations?: PaperAnnotation[];
        onSelection?: (selection: AnnotationInput | null, position?: { x: number; y: number }) => void;
        onHighlight?: (id: string, position: { x: number; y: number }, annotation?: boolean) => void;
    };

    type Status =
        | { kind: "empty" }
        | { kind: "loading" }
        | { kind: "password"; incorrect: boolean }
        | { kind: "ready" }
        | { kind: "error"; error: ReaderError };

    const { source, viewState, onViewStateChange, onError, onPasswordAccepted, fileId, annotations = [], onSelection, onHighlight }: Props = $props();

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
    let acceptedPassword = "";

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
        eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => {
            void loadCharacters(pageNumber);
            paintHighlights();
        });
        eventBus.on("rotationchanging", paintHighlights);
        eventBus.on("updatefindmatchescount", ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
            if (findStatus.kind === "found") findStatus = { ...findStatus, ...matchesCount };
        });

        pdf = created;
        window.addEventListener("workspace-flush", reportViewState);
        return () => window.removeEventListener("workspace-flush", reportViewState);
    });

    $effect(() => {
        void annotations; const viewer = pdf; if (viewer) untrack(paintHighlights);
    });

    // Character geometry lives in PDF user space. DOM text remains for find/accessibility only.
    // Geometry and in-flight requests are read imperatively by pointer handlers.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const characters = new Map<number, PdfCharacter[]>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const pendingCharacters = new Map<number, Promise<void>>();
    let drag: { page: number; start: number; end: number; initial: [number, number]; unit: number; pointer: number } | null = null;
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
    function point(event: PointerEvent, number?: number): { page: number; x: number; y: number } | null {
        const page = number ?? Number((event.target as Element)?.closest?.(".page")?.getAttribute("data-page-number"));
        const view = pdf?.viewer.getPageView(page - 1);
        if (!view?.pdfPage) return null;
        const bounds = view.div.getBoundingClientRect();
        // viewport is the content box; page borders are outside its coordinates.
        const [x, y] = view.viewport.convertToPdfPoint(event.clientX - bounds.left - view.div.clientLeft, event.clientY - bounds.top - view.div.clientTop);
        return { page, x, y };
    }
    function startSelection(event: PointerEvent): void {
        if (event.button !== 0 || !fileId || status.kind !== "ready" || (event.target as Element)?.closest?.(".knowledge-highlights")) return;
        const at = point(event);
        if (!at) return;
        const chars = characters.get(at.page);
        if (!chars) {
            void loadCharacters(at.page); return;
        }
        const index = hitTest(chars, at.x, at.y);
        if (index < 0) {
            clearSelection(); return;
        }
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        container.focus({ preventScroll: true });
        const repeated = event.timeStamp - clicks.time < 500 && Math.hypot(event.clientX - clicks.x, event.clientY - clicks.y) < 5;
        clicks = { time: event.timeStamp, x: event.clientX, y: event.clientY, count: repeated ? clicks.count % 3 + 1 : 1 };
        const [start, end] = clicks.count === 3 ? lineRange(chars, index) : clicks.count === 2 ? wordRange(chars, index) : [index, index];
        drag = { page: at.page, start, end, initial: [start, end], unit: clicks.count, pointer: event.pointerId };
        container.setPointerCapture(event.pointerId);
        updateSelection(false);
    }
    function moveSelection(event: PointerEvent): void {
        if (!drag || drag.pointer !== event.pointerId) return;
        const started = event.timeStamp;
        const at = point(event, drag.page);
        if (!at) return;
        const chars = characters.get(drag.page) ?? [];
        const index = hitTest(chars, at.x, at.y, true);
        if (index < 0) return;
        const range = drag.unit === 3 ? lineRange(chars, index) : drag.unit === 2 ? wordRange(chars, index) : [index, index];
        const backwards = range[0] < drag.initial[0];
        drag.start = backwards ? drag.initial[1] : drag.initial[0];
        drag.end = backwards ? range[0] : Math.max(drag.initial[1], range[1]);
        updateSelection(false);
        if (import.meta.env.DEV) afterPaint(() => {
            feedback.push(performance.now() - started);
            if (feedback.length > 512) feedback.shift();
        });
    }
    function finishSelection(event: PointerEvent): void {
        if (!drag || drag.pointer !== event.pointerId) return;
        updateSelection(true);
        if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
        drag = null;
        if (import.meta.env.DEV) afterPaint(() => {
            const sorted = [...feedback].sort((a, b) => a - b);
            if (sorted.length) console.debug("PDF drag feedback", JSON.stringify({ samples: sorted.length, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], characters: characters.get(selected?.pageNumber ?? 0)?.length ?? 0 }));
        });
    }
    function cancelDrag(): void {
        drag = null; clearSelection();
    }
    function updateSelection(report: boolean): void {
        if (!drag || !fileId) return;
        const chars = characters.get(drag.page) ?? [];
        const rectangles = selectionRectangles(chars, drag.start, drag.end);
        const quote = extractText(chars, rectangles);
        selected = quote.trim() && rectangles.length ? { fileId, pageNumber: drag.page, rectangles, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION } : null;
        paintSelection();
        if (report) onSelection?.(selected, selected ? selectionPosition(selected) : undefined);
        else onSelection?.(null);
    }
    function selectionPosition(anchor: AnnotationInput): { x: number; y: number } {
        const view = pdf!.viewer.getPageView(anchor.pageNumber - 1), rect = anchor.rectangles.at(-1)!;
        const [x, y] = view.viewport.convertToViewportPoint(rect.x + rect.width, rect.y);
        const bounds = view.div.getBoundingClientRect();
        return { x: bounds.left + view.div.clientLeft + x, y: bounds.top + view.div.clientTop + y };
    }
    export function clearSelection(): void {
        selected = null;
        drag = null;
        onSelection?.(null);
        paintSelection();
    }
    function copySelection(event: ClipboardEvent): void {
        if (!selected || (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable=true]"))) return;
        event.preventDefault();
        // Use exactly the same rectangle rule as the persisted cache.
        event.clipboardData?.setData("text/plain", extractText(characters.get(selected.pageNumber) ?? [], selected.rectangles));
    }
    function drawRectangle(layer: HTMLElement, rect: PaperAnnotation["rectangles"][number], number: number, color: string): HTMLElement {
        const view = pdf!.viewer.getPageView(number - 1);
        const [x1, y1] = view.viewport.convertToViewportPoint(rect.x, rect.y);
        const [x2, y2] = view.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
        const mark = document.createElement("span");
        Object.assign(mark.style, { position: "absolute", left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px`, backgroundColor: color, opacity: ".45" });
        layer.appendChild(mark);
        return mark;
    }
    function paintSelection(): void {
        container?.querySelectorAll(".knowledge-selection").forEach(layer => layer.remove());
        if (!pdf || !selected) return;
        const view = pdf.viewer.getPageView(selected.pageNumber - 1);
        if (!view?.pdfPage) return;
        const layer = document.createElement("div");
        layer.className = "knowledge-selection";
        Object.assign(layer.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "4" });
        selected.rectangles.forEach(rect => drawRectangle(layer, rect, selected!.pageNumber, "#8ab4f8"));
        view.div.appendChild(layer);
    }

    function paintHighlights(): void {
        if (!pdf) return;
        container.querySelectorAll(".knowledge-highlights").forEach(layer => layer.remove());
        for (const anchor of annotations) {
            const highlight = anchor;
            if (!anchor || anchor.fileId !== fileId) continue;
            const view = pdf.viewer.getPageView(anchor.pageNumber - 1);
            if (!view?.pdfPage) continue;
            const layer = document.createElement("div");
            layer.className = "knowledge-highlights";
            Object.assign(layer.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "2", mixBlendMode: "multiply" });
            for (const rect of anchor.rectangles) {
                const mark = drawRectangle(layer, rect, anchor.pageNumber, annotationColors[highlight.color].value);
                Object.assign(mark.style, { pointerEvents: "auto", cursor: "pointer" });
                mark.onclick = event => {
                    event.stopPropagation(); onHighlight?.(highlight.id, { x: event.clientX, y: event.clientY });
                };
            }
            if (highlight.hasText && anchor.rectangles.length) {
                const rect = anchor.rectangles[0];
                const [x, y] = view.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
                const note = document.createElement("button");
                note.textContent = "▤";
                note.title = "编辑批注";
                note.setAttribute("aria-label", "编辑批注");
                Object.assign(note.style, { position: "absolute", left: `${x}px`, top: `${y - 18}px`, width: "22px", height: "22px", background: "var(--c-paper)", color: "var(--c-ink)", border: "1px solid var(--c-line)", borderRadius: "4px", pointerEvents: "auto", cursor: "pointer", fontSize: "16px", lineHeight: "20px" });
                note.onclick = event => {
                    event.stopPropagation(); onHighlight?.(highlight.id, { x: event.clientX, y: event.clientY }, true);
                };
                layer.appendChild(note);
            }
            view.div.appendChild(layer);
        }
        paintSelection();
    }

    $effect(() => {
        const current = source;
        const viewer = pdf;
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
            drawingDelay: 400,
            // One wheel notch (100px) is one zoom step, while touchpad pinches zoom smoothly.
            scaleFactor: 1.1 ** (-event.deltaY / 100),
            origin: [event.clientX - rect.left, event.clientY - rect.top]
        });
    }

    function onkeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") clearSelection();
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