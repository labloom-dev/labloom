import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { record, validUUID } from "../../shared/attrs/values";
import { rectangleWithinPage } from "../../shared/content/anchors";
import { annotationColors, type AnnotationColor } from "../../shared/content/annotations";
import { charactersFromTextContent, extractText, PDF_EXTRACTOR_VERSION, type PdfCharacter } from "../../shared/content/pdf-text";
import { diagnostic, LabloomError, toFailureInfo } from "../../shared/failure";
import { type AttributeValue } from "../../shared/types/attributes";
import { type CommitResult, type PageRecord } from "../../shared/types/content";
import { type AnnotationInput, type Attachment, type PaperAnnotation, type PaperImport, type PaperResources, type ReadingPosition } from "../../shared/types/papers";
import { importFeedPDF } from "../feed/pdf";
import { attachmentPath } from "../storage/files";
import { attachments } from "../storage/tables";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import * as commit from "./commit";
import * as edits from "./edits";
import * as data from "./records";

const mediaTypes: Record<string, string> = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values",
    json: "application/json", xml: "application/xml", html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text", rtf: "application/rtf", epub: "application/epub+zip",
    zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", "7z": "application/x-7z-compressed", rar: "application/vnd.rar",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime"
};
const mediaType = (path: string): string => mediaTypes[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream";

const loadingTasks = new Set<PDFDocumentLoadingTask>();
const documents = new Map<string, Promise<PDFDocumentProxy>>();
const extracted = new Map<string, Promise<{ bounds: number[]; characters: PdfCharacter[] }>>();
export function release(): void {
    for (const task of loadingTasks) void task.destroy().catch(() => { });
    loadingTasks.clear();
    for (const document of documents.values()) void document.then(value => value.loadingTask.destroy()).catch(() => { });
    documents.clear();
    extracted.clear();
}
async function pageText(fileId: string, pageNumber: number): Promise<{ bounds: number[]; characters: PdfCharacter[] }> {
    const session = workspace.requireWorkspace();
    // Check the managed file size even when the parsed document/page is already cached.
    requirePDF(fileId);
    const data = read(fileId), key = `${fileId}:${pageNumber}`;
    let document = documents.get(fileId);
    if (!document) {
        document = loadPDF(data);
        documents.set(fileId, document);
        void document.catch(() => {
            if (workspace.isCurrent(session)) documents.delete(fileId);
        });
    }
    let result = extracted.get(key);
    if (!result) {
        result = (async () => {
            const loaded = await document;
            if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > loaded.numPages) throw new LabloomError({ kind: "pdf-page-range" });
            const page = await loaded.getPage(pageNumber), content = await page.getTextContent();
            return { bounds: page.view, characters: charactersFromTextContent(content) };
        })();
        extracted.set(key, result);
        void result.catch(() => {
            if (workspace.isCurrent(session)) extracted.delete(key);
        });
    }
    return result;
}

async function loadPDF(data: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
    const session = workspace.requireWorkspace();
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!workspace.isCurrent(session)) throw new LabloomError({ kind: "workspace-not-ready" });
    const require = createRequire(join(process.cwd(), "package.json"));
    // import.meta.resolve is available in the app; bundled CJS tests use their project directory.
    const packageFile = typeof import.meta.resolve === "function" ? fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")) : require.resolve("pdfjs-dist/package.json");
    const assets = dirname(packageFile);
    const task = getDocument({
        data, password, disableFontFace: true, useSystemFonts: false,
        cMapUrl: `${assets}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}/standard_fonts/`,
        wasmUrl: `${assets}/wasm/`
    });
    loadingTasks.add(task);
    try {
        return await task.promise;
    }
    catch (error) {
        await task.destroy();
        throw new LabloomError(toFailureInfo(error), { cause: error });
    }
    finally {
        loadingTasks.delete(task);
    }
}

export async function unlockPDF(fileId: string, password: string): Promise<void> {
    workspace.requireWorkspace();
    if (typeof password !== "string") throw new LabloomError({ kind: "pdf-invalid-password" });
    requirePDF(fileId);
    const session = workspace.requireWorkspace();
    const document = await loadPDF(read(fileId), password).catch(error => {
        if (workspace.isCurrent(session)) throw error; return null;
    });
    if (!document) return;
    const existing = await documents.get(fileId)?.catch(() => null);
    if (existing) {
        await document.loadingTask.destroy();
        return;
    }
    if (!workspace.isCurrent(session)) {
        await document.loadingTask.destroy();
        return;
    }
    documents.set(fileId, Promise.resolve(document));
    for (const key of extracted.keys()) if (key.startsWith(fileId + ":")) extracted.delete(key);
}

function paper(id: string, writable = false): PageRecord {
    const page = data.get(id);
    if (page.kind !== "paper" || (writable && page.attributes.deleted)) throw new LabloomError({ kind: "paper-unavailable" });
    return page;
}

export function createReference(paper: { title: string; authors: string; url: string | null; abstract: string; published: string | null; origin: Record<string, string | null> }): string {
    workspace.requireWorkspace();
    return edits.createPage("paper", paper.title, {
        paper_authors: paper.authors, paper_url: paper.url ?? "", paper_abstract: paper.abstract, paper_year: paper.published ?? "", source_snapshot: paper.origin
    }).id;
}

export function state(id: string): "saved" | "recycled" | "missing" {
    workspace.requireWorkspace();
    if (!data.statement("SELECT 1 FROM pages WHERE id=? AND kind='paper'").get(id)) return "missing";
    return data.flags(id).deleted ? "recycled" : "saved";
}

export function files(ids?: string[]): Attachment[] {
    workspace.requireWorkspace();
    if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => !validUUID(id)))) throw new LabloomError({ kind: "attachment-invalid-list" });
    if (ids && !ids.length) return [];
    const rows = workspace.database().select().from(attachments).where(ids ? sql`${attachments.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))` : undefined).all();
    const byId = new Map(rows.map(file => [file.id, file]));
    const localFiles = ids ? ids.map(id => byId.get(id)).filter(file => file !== undefined) : rows;
    return localFiles.map(({ storedName: _name, ...file }) => file);
}

function paperFiles(pageId: string): Attachment[] {
    return files(paper(pageId).attributes.paper_files as string[]);
}

function requirePDF(id: string): void {
    if (files([id])[0]?.mediaType !== "application/pdf") throw new LabloomError({ kind: "attachment-pdf-required" });
}

export function hasPDF(pageId: string): boolean {
    workspace.requireWorkspace();
    return Boolean(data.statement(`SELECT 1 FROM page_attrs p JOIN pages ON pages.id=p.page_id
        JOIN json_each(p.value) f JOIN attachments a ON a.id=f.value
        WHERE p.page_id=? AND p.attr_id='paper_files' AND pages.kind='paper' AND a.media_type='application/pdf' LIMIT 1`).get(pageId));
}

function importing<T>(action: (store: (path: string) => Attachment) => T, sourceTab = ""): T {
    const created: string[] = [], db = workspace.database();
    try {
        return commit.run({ sourceTab, history: false }, () => action(path => {
            const data = readFileSync(path), suffix = extname(path), type = mediaType(path);
            if (type === "application/pdf" && !data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new LabloomError({ kind: "pdf-invalid" });
            const id = randomUUID(), file = { id, storedName: id + suffix, originalName: basename(path), mediaType: type, size: data.length };
            const target = attachmentPath(workspace.root(), file.storedName);
            mkdirSync(join(workspace.root(), "attachments"), { recursive: true });
            writeFileSync(target, data, { flag: "wx" });
            created.push(target);
            db.insert(attachments).values(file).run();
            const { storedName: _name, ...result } = file;
            return result;
        }));
    }
    catch (error) {
        for (const path of created) unlinkSync(path);
        throw error;
    }
}

function append(pageId: string, attributeId: string, files: Attachment[], tabId?: string): void {
    const definition = attributes.definition(attributeId), page = data.get(pageId);
    if (definition.type !== "file" && definition.type !== "files") throw new LabloomError({ kind: "attribute-file-required" });
    if (definition.type === "file" && files.length !== 1) throw new LabloomError({ kind: "attribute-single-file" });
    const current = page.attributes[attributeId];
    const value = definition.type === "file" ? files[0].id : [...new Set([...(Array.isArray(current) ? current as string[] : []), ...files.map(file => file.id)])];
    const result = edits.commitEdit({ pageId, tabId: tabId ?? "file-import", batch: 0, blocks: [], attributes: { [attributeId]: value } });
    if (result.status !== "saved") throw new LabloomError({ kind: "attachment-write-failed" });
    if (!tabId) commit.invalidate(["page:" + pageId]);
}

export function attachFiles(paths: string[], pageId: string, attributeId: string, tabId?: string): Attachment[] {
    workspace.requireWorkspace();
    if (!Array.isArray(paths) || !paths.length) throw new LabloomError({ kind: "attachment-selection-required" });
    return importing(store => {
        const localFiles = paths.map(store);
        append(pageId, attributeId, localFiles, tabId);
        return localFiles;
    }, tabId);
}

export function importFile(path: string, pageId?: string, tabId?: string): PaperImport {
    workspace.requireWorkspace();
    if (pageId) paper(pageId, true);
    return importing(store => {
        const file = store(path);
        const page = pageId ? paper(pageId, true) : edits.createPage("paper", basename(path, extname(path)), { source_snapshot: { originalName: basename(path) } });
        append(page.id, "paper_files", [file], tabId);
        return { pageId: page.id };
    }, tabId);
}

export function read(id: string): Uint8Array {
    workspace.requireWorkspace();
    if (!validUUID(id)) throw new LabloomError({ kind: "attachment-invalid-id" });
    const file = workspace.database().select().from(attachments).where(eq(attachments.id, id)).get();
    if (!file) throw new LabloomError({ kind: "attachment-unavailable" });
    const path = attachmentPath(workspace.root(), file.storedName);
    let data: Buffer;
    try {
        data = readFileSync(path);
    }
    catch (error) {
        throw new LabloomError({ kind: "attachment-read-failed", diagnostic: diagnostic(error) }, { cause: error });
    }
    if (data.length !== file.size) throw new LabloomError({ kind: "attachment-size-changed" });
    return new Uint8Array(data);
}

export function externalPath(id: string): string {
    workspace.requireWorkspace();
    read(id);
    const file = workspace.database().select().from(attachments).where(eq(attachments.id, id)).get()!;
    return attachmentPath(workspace.root(), file.storedName);
}

function annotationData(page: PageRecord): PaperAnnotation {
    const a = page.attributes, localPosition = a.annotation_position;
    if (page.kind !== "annotation" || typeof a.annotation_file !== "string" || !record(localPosition) || !Number.isInteger(localPosition.page) || !Array.isArray(localPosition.rects) || typeof a.annotation_color !== "string" || !Object.hasOwn(annotationColors, a.annotation_color)) throw new LabloomError({ kind: "annotation-invalid-position" });
    return {
        id: page.id, fileId: a.annotation_file, pageNumber: Number(localPosition.page), rectangles: localPosition.rects as PaperAnnotation["rectangles"],
        quote: String(a.annotation_quote), context: String(a.annotation_context), extractorVersion: String(a.annotation_extractor), color: a.annotation_color as AnnotationColor, hasText: !!page.excerpt.trim()
    };
}

export async function getAnnotation(id: string): Promise<PaperAnnotation> {
    const session = workspace.requireWorkspace(), page = data.get(id);
    if (page.attributes.deleted) throw new LabloomError({ kind: "page-deleted" });
    const annotation = annotationData(page);
    if (annotation.extractorVersion === PDF_EXTRACTOR_VERSION) return annotation;
    const extracted = await pageText(annotation.fileId, annotation.pageNumber).catch(error => {
        if (workspace.isCurrent(session)) throw error; return null;
    });
    if (!extracted || !workspace.isCurrent(session)) return annotation;
    const { characters } = extracted;
    if (!workspace.isCurrent(session)) return annotation;
    const quote = extractText(characters, annotation.rectangles);
    // The page may have changed while PDF extraction was awaiting a worker.
    const current = data.get(id), next = annotationData(current);
    if (current.attributes.deleted) throw new LabloomError({ kind: "page-deleted" });
    if (next.fileId !== annotation.fileId || JSON.stringify(next.rectangles) !== JSON.stringify(annotation.rectangles) || next.pageNumber !== annotation.pageNumber) return getAnnotation(id);
    edits.cacheAttributes(id, { annotation_quote: quote, annotation_context: quote, annotation_extractor: PDF_EXTRACTOR_VERSION });
    return { ...next, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION };
}

export async function resources(pageId: string): Promise<PaperResources> {
    const session = workspace.requireWorkspace();
    const page = paper(pageId), localFiles = paperFiles(pageId), available = new Set(localFiles.filter(file => file.mediaType === "application/pdf").map(file => file.id));
    const annotations: PaperAnnotation[] = [];
    for (const id of page.attributes.paper_annotations as string[]) {
        if (!workspace.isCurrent(session)) return { files: localFiles, annotations };
        if (!data.statement("SELECT 1 FROM pages WHERE id=? AND kind='annotation'").get(id) || data.flags(id).deleted) continue;
        const record = data.get(id);
        if (!available.has(String(record.attributes.annotation_file))) continue;
        try {
            annotations.push(await getAnnotation(id));
        }
        catch (error) {
            if (!workspace.isCurrent(session)) return { files: localFiles, annotations };
            if (["pdf-password-required", "pdf-password-incorrect"].includes(toFailureInfo(error).kind)) annotations.push({ ...annotationData(record), quote: "", context: "" });
            else throw error;
        }
    }
    return { files: localFiles, annotations };
}

async function prepareAnnotation(pageId: string, value: AnnotationInput): Promise<AnnotationInput> {
    paper(pageId, true);
    if (!record(value) || !validUUID(value.fileId) || !Number.isInteger(value.pageNumber) || value.pageNumber < 1 || !Array.isArray(value.rectangles) || !value.rectangles.length || typeof value.quote !== "string" || typeof value.context !== "string" || typeof value.extractorVersion !== "string") throw new LabloomError({ kind: "annotation-invalid-input" });
    const file = paperFiles(pageId).find(file => file.id === value.fileId);
    if (!file) throw new LabloomError({ kind: "paper-file-removed" });
    if (file.mediaType !== "application/pdf") throw new LabloomError({ kind: "attachment-pdf-required" });
    const { bounds, characters } = await pageText(value.fileId, value.pageNumber);
    for (const rect of value.rectangles) if (!record(rect) || !rectangleWithinPage(rect, bounds)) throw new LabloomError({ kind: "annotation-outside-page" });
    const rectangles = value.rectangles.map(({ x, y, width, height }) => ({ x, y, width, height })), quote = extractText(characters, rectangles);
    return { fileId: value.fileId, pageNumber: value.pageNumber, rectangles, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION };
}

export function changeAnnotation(id: string, color: string, tabId: string): CommitResult {
    workspace.requireWorkspace();
    if (!Object.hasOwn(annotationColors, color)) throw new LabloomError({ kind: "annotation-invalid-color" });
    if (data.header(id).kind !== "annotation") throw new LabloomError({ kind: "annotation-unavailable" });
    return edits.commitEdit({ pageId: id, tabId, batch: 0, blocks: [], attributes: { annotation_color: color } });
}

export function deleteAnnotation(id: string, tabId: string, confirmation?: string): CommitResult {
    workspace.requireWorkspace();
    if (data.header(id).kind !== "annotation") throw new LabloomError({ kind: "annotation-unavailable" });
    return edits.trash([id], tabId, confirmation);
}

export async function annotate(pageId: string, input: AnnotationInput | string, tabId: string, color = "yellow"): Promise<string> {
    const session = workspace.requireWorkspace();
    if (!Object.hasOwn(annotationColors, color)) throw new LabloomError({ kind: "annotation-invalid-color" });
    if (typeof input === "string") {
        if (!(paper(pageId, true).attributes.paper_annotations as string[]).includes(input)) throw new LabloomError({ kind: "annotation-unavailable" });
        await getAnnotation(input);
        return input;
    }
    const prepared = await prepareAnnotation(pageId, input).catch(error => {
        if (workspace.isCurrent(session)) throw error; return null;
    });
    if (!workspace.isCurrent(session) || !prepared) return "";
    return commit.run({ sourceTab: tabId, history: false }, () => {
        const localPaper = paper(pageId, true);
        if (!(localPaper.attributes.paper_files as string[]).includes(prepared.fileId)) throw new LabloomError({ kind: "paper-file-removed" });
        const localPosition = { page: prepared.pageNumber, rects: prepared.rectangles };
        return edits.createPage("annotation", [...prepared.quote].slice(0, 70).join(""), {
            annotation_file: prepared.fileId, annotation_position: localPosition, annotation_color: color,
            annotation_quote: prepared.quote, annotation_context: prepared.context, annotation_extractor: PDF_EXTRACTOR_VERSION
        }, pageId, tabId).id;
    });
}

export function position(pageId: string, fileId: string, position: ReadingPosition, sourceTab = ""): void {
    workspace.requireWorkspace();
    commit.run({ sourceTab, history: false, updateModified: false }, context => {
        const page = paper(pageId, true);
        if (!paperFiles(pageId).some(file => file.id === fileId && file.mediaType === "application/pdf") || !record(position) || !Number.isInteger(position.page) || position.page < 1 || ![0, 90, 180, 270].includes(position.rotation) || !Number.isFinite(position.left) || !Number.isFinite(position.top) || !(typeof position.scale === "number" && position.scale > 0 && position.scale <= 10 || ["auto", "page-width", "page-fit", "page-actual"].includes(String(position.scale)))) throw new LabloomError({ kind: "paper-invalid-position" });
        edits.writeAttributes(pageId, { reading_position: { ...(record(page.attributes.reading_position) ? page.attributes.reading_position : {}), [fileId]: position as unknown as AttributeValue } }, true);
        context.change({ pages: [pageId] });
    });
}
/** Reading an annotation refreshes its source-text cache through the write boundary. */
export async function get(pageId: string): Promise<PageRecord> {
    const session = workspace.requireWorkspace(), page = data.get(pageId);
    if (page.kind === "annotation" && !page.attributes.deleted) await getAnnotation(pageId);
    return workspace.isCurrent(session) ? data.get(pageId) : page;
}
export async function importPDF(pageId: string, url: string): Promise<void> {
    const session = workspace.requireWorkspace();
    try {
        await importFeedPDF(url, path => {
            if (workspace.isCurrent(session)) importFile(path, pageId);
        }, session.fetchPDF, undefined, session.controller.signal);
    }
    catch (error) {
        if (workspace.isCurrent(session)) throw error;
    }
}
export function fileSelection(attributeId: string): boolean {
    workspace.requireWorkspace();
    const definition = attributes.definition(attributeId);
    if (definition.type !== "file" && definition.type !== "files") throw new LabloomError({ kind: "attribute-file-required" });
    return definition.type === "files";
}