<div class="reader" onkeydown={onkeydown} onpointerup={selectText} onkeyup={selectText}>
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
        <div class="viewer" tabindex="-1" bind:this={container} {onwheel}>
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
                <input aria-label="PDF 密码" type="password" autocomplete="off" bind:value={password} {@attach element => element.focus()} />
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
</style>


<script lang="ts">
    import { onMount, untrack } from "svelte";
    import Bloom from "../utils/Bloom.svelte";
    import Toolbar from "./Toolbar.svelte";
    import type { ReaderError, ReaderFindStatus, ReaderScale, ReaderSource, ReaderViewState } from "./defs";
    import { type Anchor, type AnchorInput, type Highlight } from "../../../shared/types/papers";
    import { normalizeRectangle, pdfRectangle } from "../../../shared/content/anchors";
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
        fileId?: string;
        anchors?: Anchor[];
        highlights?: Highlight[];
        onSelection?: (selection: AnchorInput | null) => void;
    };

    type Status =
        | { kind: "empty" }
        | { kind: "loading" }
        | { kind: "password"; incorrect: boolean }
        | { kind: "ready" }
        | { kind: "error"; error: ReaderError };

    const { source, viewState, onViewStateChange, onError, fileId, anchors = [], highlights = [], onSelection }: Props = $props();

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
    let anchorToOpen: Anchor | null = null;

    onMount(() => {
        const created = createViewer(container);
        const { eventBus, viewer } = created;

        eventBus.on("pagesinit", () => {
            if (viewState) applyViewState(viewer, viewState);
            else viewer.currentScaleValue = "auto";
            restoring = false;
            if (anchorToOpen) goToAnchor(anchorToOpen);
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
        eventBus.on("pagerendered", () => {
            paintHighlights();
            if (anchorToOpen) goToAnchor(anchorToOpen);
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
        void anchors; void highlights; const viewer = pdf; if (viewer) untrack(paintHighlights);
    });

    function selectText(): void {
        if (!onSelection || !fileId || !pdf || status.kind !== "ready") return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
            onSelection(null); return;
        }
        const range = selection.getRangeAt(0);
        const start = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)?.closest<HTMLElement>(".page");
        const end = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement)?.closest<HTMLElement>(".page");
        if (!start || start !== end || !container.contains(start)) {
            onSelection(null); return;
        }
        const number = Number(start.dataset.pageNumber), view = pdf.viewer.getPageView(number - 1);
        if (!view?.pdfPage) return;
        const bounds = start.getBoundingClientRect();
        const rectangles = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => {
            const a = view.viewport.convertToPdfPoint(rect.left - bounds.left, rect.top - bounds.top), b = view.viewport.convertToPdfPoint(rect.right - bounds.left, rect.bottom - bounds.top);
            return normalizeRectangle([a[0], a[1], b[0], b[1]], view.pdfPage!.view);
        }).filter(rect => rect.width > 0 && rect.height > 0);
        const quote = selection.toString().trim();
        onSelection(quote && rectangles.length ? { fileId, pageNumber: number, rectangles, quote, context: quote } : null);
    }

    function paintHighlights(): void {
        if (!pdf) return;
        container.querySelectorAll(".knowledge-highlights").forEach(layer => layer.remove());
        for (const highlight of highlights) {
            const anchor = anchors.find(item => item.id === highlight.anchorId);
            if (!anchor || anchor.fileId !== fileId) continue;
            const view = pdf.viewer.getPageView(anchor.pageNumber - 1);
            if (!view?.pdfPage) continue;
            const layer = document.createElement("div");
            layer.className = "knowledge-highlights";
            Object.assign(layer.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "2", mixBlendMode: "multiply" });
            for (const rect of anchor.rectangles) {
                const [left, top, right, bottom] = pdfRectangle(rect, view.pdfPage.view);
                const [x1, y1] = view.viewport.convertToViewportPoint(left, top);
                const [x2, y2] = view.viewport.convertToViewportPoint(right, bottom);
                const mark = document.createElement("span");
                Object.assign(mark.style, { position: "absolute", left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px`, backgroundColor: highlight.color, opacity: ".5" });
                layer.appendChild(mark);
            }
            view.div.appendChild(layer);
        }
    }

    export function goToAnchor(anchor: Anchor): void {
        anchorToOpen = anchor;
        if (!pdf || status.kind !== "ready") return;
        pdf.viewer.currentPageNumber = anchor.pageNumber;
        const view = pdf.viewer.getPageView(anchor.pageNumber - 1);
        if (!view?.pdfPage || !anchor.rectangles.length) return;
        const [left, top] = pdfRectangle(anchor.rectangles[0], view.pdfPage.view);
        pdf.viewer.scrollPageIntoView({ pageNumber: anchor.pageNumber, destArray: [null, { name: "XYZ" }, left, top, null], allowNegativeOffset: true });
        anchorToOpen = null;
    }

    $effect(() => {
        const current = source;
        const viewer = pdf;
        if (!viewer) return;
        return untrack(() => open(viewer, current));
    });

    function open(viewer: Viewer, current: ReaderSource | null): (() => void) | undefined {
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