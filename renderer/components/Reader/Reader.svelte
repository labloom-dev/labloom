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
    <div class="body">
        <div class="viewer" tabindex="-1" bind:this={container} {onwheel}>
            <div class="pdfViewer"></div>
        </div>
        {#if status.kind === "empty"}
            <div class="overlay">
                <p>没有可显示的 PDF。</p>
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
    import Toolbar from "./Toolbar.svelte";
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
    };

    type Status =
        | { kind: "empty" }
        | { kind: "loading" }
        | { kind: "password"; incorrect: boolean }
        | { kind: "ready" }
        | { kind: "error"; error: ReaderError };

    const { source, viewState, onViewStateChange, onError }: Props = $props();

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

        pdf = created;
    });

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