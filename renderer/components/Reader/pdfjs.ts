// The legacy build polyfills newer built-ins (e.g. Map#getOrInsertComputed) that the modern build requires
// but Electron 39's Chromium lacks. Its pdf_viewer.mjs reads pdf.js from `globalThis.pdfjsLib`, so pdf.mjs must
// be imported first.
import {
    AnnotationMode,
    getDocument,
    GlobalWorkerOptions,
    InvalidPDFException,
    PasswordResponses,
    type PDFDocumentLoadingTask,
    type PDFDocumentProxy
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { EventBus, FindState, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import viewerCss from "pdfjs-dist/legacy/web/pdf_viewer.css?inline";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { scalePresets, type ReaderError, type ReaderRotation, type ReaderScalePreset, type ReaderViewState } from "./defs";

export { FindState, PasswordResponses, type PDFDocumentProxy };

GlobalWorkerOptions.workerSrc = workerUrl;

/** Copied out of pdfjs-dist by the build, see configs/electron.vite.config.ts. */
function resourceUrl(directory: string): string {
    return new URL(`pdfjs/${directory}/`, document.baseURI).href;
}

export function loadDocument(data: Uint8Array): PDFDocumentLoadingTask {
    return getDocument({
        // pdf.js transfers the buffer to its worker, which would empty the caller's copy.
        data: data.slice(),
        cMapUrl: resourceUrl("cmaps"),
        cMapPacked: true,
        standardFontDataUrl: resourceUrl("standard_fonts"),
        wasmUrl: resourceUrl("wasm"),
        iccUrl: resourceUrl("iccs"),
        enableXfa: false
    });
}

export type Viewer = {
    eventBus: EventBus;
    linkService: PDFLinkService;
    findController: PDFFindController;
    viewer: PDFViewer;
};

export type ViewerLocation = {
    pageNumber: number;
    top: number;
    left: number;
    rotation: number;
};

/** `container` must be absolutely positioned and contain an empty `div.pdfViewer`. */
export function createViewer(container: HTMLDivElement): Viewer {
    // Keep pdf.js' root defaults (especially color-scheme) inside this viewer.
    const style = document.createElement("style");
    style.textContent = `@scope {${viewerCss.replaceAll(":root", ":scope")}
        /* PDFViewer updates this variable on document.documentElement. */
        :scope { --viewer-container-height: inherit; }
    }`;
    container.append(style);

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    // Links inside a PDF are untrusted, and the main process opens any external URL it is given.
    // Only in-document links (outline, citations, figures) stay enabled.
    linkService.externalLinkEnabled = false;
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({
        container,
        eventBus,
        linkService,
        findController,
        annotationMode: AnnotationMode.ENABLE,
        enableAutoLinking: false,
        // Would insert blob: images, which the CSP rejects.
        imagesRightClickMinSize: -1
    });
    linkService.setViewer(viewer);
    return { eventBus, linkService, findController, viewer };
}

/** Pass `null` to detach the current document. */
export function setDocument({ viewer, linkService, findController }: Viewer, pdfDocument: PDFDocumentProxy | null): void {
    // pdf.js accepts null here, but its typings don't say so.
    const doc = pdfDocument as PDFDocumentProxy;
    viewer.setDocument(doc);
    linkService.setDocument(doc);
    findController.setDocument(doc);
}

export function isScalePreset(value: string): value is ReaderScalePreset {
    return (scalePresets as readonly string[]).includes(value);
}

export function getViewState(viewer: PDFViewer, location: ViewerLocation): ReaderViewState {
    const scaleValue = viewer.currentScaleValue;
    return {
        pageNumber: location.pageNumber,
        scale: isScalePreset(scaleValue) ? scaleValue : viewer.currentScale,
        rotation: location.rotation as ReaderRotation,
        left: location.left,
        top: location.top
    };
}

export function applyViewState(viewer: PDFViewer, state: ReaderViewState): void {
    viewer.pagesRotation = state.rotation;
    viewer.currentScaleValue = typeof state.scale === "number" && !(state.scale > 0) ? "auto" : String(state.scale);
    viewer.scrollPageIntoView({
        pageNumber: Math.min(Math.max(1, Math.round(state.pageNumber)), viewer.pagesCount),
        destArray: [null, { name: "XYZ" }, state.left, state.top, null],
        allowNegativeOffset: true
    });
}

/** Scanned PDFs usually have no text layer at all, so searching them can't find anything. */
export async function hasText(pdfDocument: PDFDocumentProxy): Promise<boolean> {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
        const page = await pdfDocument.getPage(pageNumber);
        const { items } = await page.getTextContent();
        if (items.some(item => "str" in item && item.str.trim())) return true;
    }
    return false;
}

export function toReaderError(error: unknown): ReaderError {
    if (error instanceof InvalidPDFException) {
        return { kind: "invalid", message: "无法打开：文件已损坏或不是有效的 PDF。" };
    }
    return { kind: "unknown", message: `无法打开 PDF：${error instanceof Error ? error.message : String(error)}` };
}