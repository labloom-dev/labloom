import { type HistorySource } from "../../shared/history/ipc";
import { eq, sql } from "drizzle-orm";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { record, validUUID } from "../../shared/attrs/values";
import { rectangleWithinPage } from "../../shared/content/anchors";
import { annotationColors, type AnnotationColor } from "../../shared/content/annotations";
import { charactersFromTextContent, extractText, PDF_EXTRACTOR_VERSION, type PdfCharacter } from "../../shared/content/pdf-text";
import { diagnostic, LabloomError, toFailureInfo } from "../../shared/failure";
import { type AttributeValue } from "../../shared/types/attributes";
import { type CommitResult, type PageRecord } from "../../shared/types/content";
import { type AnnotationInput, type AnnotationPaper, type Attachment, type PaperAnnotation, type PaperImport, type PaperImportBatch, type PaperResources, type ReadingPosition } from "../../shared/types/papers";
import * as attachmentFiles from "../attachments/service";
import { attachmentPath } from "../storage/files";
import { attachments } from "../storage/tables";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import * as commit from "./commit";
import * as edits from "./edits";
import * as data from "./records";

const loadingTasks = new Set<PDFDocumentLoadingTask>();
const documents = new Map<string, Promise<PDFDocumentProxy>>();
type PageText = { bounds: number[]; characters: PdfCharacter[] };
const extracted = new Map<string, PageText | Promise<PageText>>();
export function release(): void {
    for (const task of loadingTasks) void task.destroy().catch(() => { });
    loadingTasks.clear();
    for (const document of documents.values()) void document.then(value => value.loadingTask.destroy()).catch(() => { });
    documents.clear();
    extracted.clear();
}
async function pageText(fileId: string, pageNumber: number): Promise<PageText> {
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
        const request = result;
        void request.then(text => {
            if (extracted.get(key) === request) extracted.set(key, text);
        }, () => {
            if (extracted.get(key) === request) extracted.delete(key);
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
    if (page.kind !== "paper") throw new LabloomError({ kind: "paper-unavailable" });
    if (writable && page.attributes.deleted) throw new LabloomError({ kind: "page-recycled-readonly" });
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

function append(pageId: string, attributeId: string, files: Attachment[], source?: HistorySource): void {
    const definition = attributes.definition(attributeId), page = data.get(pageId);
    if (definition.type !== "file" && definition.type !== "files") throw new LabloomError({ kind: "attribute-file-required" });
    if (definition.type === "file" && files.length !== 1) throw new LabloomError({ kind: "attribute-single-file" });
    const current = page.attributes[attributeId];
    const value = definition.type === "file" ? files[0].id : [...new Set([...(Array.isArray(current) ? current as string[] : []), ...files.map(file => file.id)])];
    const result = edits.commitEdit({ pageId, batch: 0, blocks: [], attributes: { [attributeId]: value } }, source ?? false);
    if (result.status !== "saved") throw new LabloomError({ kind: "attachment-write-failed" });
    if (!source) commit.invalidate(["page:" + pageId]);
}

export function attachFile(pageId: string, attributeId: string, fileId: string, source: HistorySource): void {
    data.writable(pageId);
    if (source.kind === "page" && source.id !== pageId) data.writable(source.id);
    const file = files([fileId])[0];
    if (!file) throw new LabloomError({ kind: "attachment-unavailable" });
    const value = data.get(pageId).attributes[attributeId];
    if (value === fileId || Array.isArray(value) && value.includes(fileId)) return;
    append(pageId, attributeId, [file], source);
}

export function attachFiles(paths: string[], pageId: string, attributeId: string, source?: HistorySource): Attachment[] {
    workspace.requireWorkspace();
    if (!Array.isArray(paths) || !paths.length) throw new LabloomError({ kind: "attachment-selection-required" });
    return attachmentFiles.importing(store => commit.run({ history: false }, () => {
        const localFiles = paths.map(store);
        append(pageId, attributeId, localFiles, source);
        return localFiles;
    }));
}

export function importFile(path: string, pageId?: string, source?: HistorySource): PaperImport {
    workspace.requireWorkspace();
    if (pageId) paper(pageId, true);
    return attachmentFiles.importing(store => commit.run({ history: false }, () => {
        const file = store(path);
        const page = pageId ? paper(pageId, true) : edits.createPage("paper", basename(path, extname(path)), { source_snapshot: { originalName: basename(path) } }, undefined, source);
        append(page.id, "paper_files", [file], source);
        return { pageId: page.id };
    }));
}

export function importPaths(paths: string[], source: HistorySource, pageId?: string, pdfOnly = !pageId): PaperImportBatch {
    workspace.requireWorkspace();
    type Entry = { path: string; error?: ReturnType<typeof toFailureInfo>; page?: string };
    const entries: Entry[] = paths.map(path => ({ path }));
    for (const entry of entries) {
        try {
            const { path } = entry;
            if (!isAbsolute(path) || !statSync(path).isFile()) throw new LabloomError({ kind: "import-regular-file" });
            accessSync(path, constants.R_OK);
            const pdf = extname(path).toLowerCase() === ".pdf";
            if (pdfOnly && !pdf) throw new LabloomError({ kind: "import-pdf-only" });
            if (pageId && pdf) attachmentFiles.checkLocalPDF(path);
            if (!pageId) entry.page = importFile(path, undefined, source).pageId;
        }
        catch (error) {
            entry.error = toFailureInfo(error);
        }
    }
    const accepted = entries.filter(entry => !entry.error);
    if (pageId && accepted.length) {
        try {
            paper(pageId, true);
            attachmentFiles.importing(store => commit.run({ history: false }, () => {
                const files: Attachment[] = [];
                for (const entry of accepted) {
                    try {
                        files.push(store(entry.path));
                    }
                    catch (error) {
                        entry.error = toFailureInfo(error);
                    }
                }
                if (files.length) append(pageId, "paper_files", files, source);
            }));
            for (const entry of accepted) if (!entry.error) entry.page = pageId;
        }
        catch (error) {
            for (const entry of accepted) entry.error ??= toFailureInfo(error);
        }
    }
    return { pages: entries.flatMap(entry => entry.page ? [entry.page] : []),
        failures: entries.flatMap(entry => entry.error ? [{ name: basename(entry.path), error: entry.error }] : []) };
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

function annotationData(id: string, a: Record<string, AttributeValue>, excerpt: string): PaperAnnotation {
    const localPosition = a.annotation_position;
    if (typeof a.annotation_file !== "string" || !record(localPosition) || !Number.isInteger(localPosition.page) || !Array.isArray(localPosition.rects) || typeof a.annotation_color !== "string" || !Object.hasOwn(annotationColors, a.annotation_color)) throw new LabloomError({ kind: "annotation-invalid-position" });
    return {
        id, fileId: a.annotation_file, pageNumber: Number(localPosition.page), rectangles: localPosition.rects as PaperAnnotation["rectangles"],
        quote: String(a.annotation_quote), context: String(a.annotation_context), extractorVersion: String(a.annotation_extractor), color: a.annotation_color as AnnotationColor, excerpt, hasText: !!excerpt.trim()
    };
}

async function getAnnotation(id: string): Promise<PaperAnnotation> {
    const session = workspace.requireWorkspace(), page = data.get(id);
    if (page.attributes.deleted) throw new LabloomError({ kind: "page-deleted" });
    if (page.kind !== "annotation") throw new LabloomError({ kind: "annotation-invalid-position" });
    const annotation = annotationData(id, page.attributes, page.excerpt);
    if (annotation.extractorVersion === PDF_EXTRACTOR_VERSION) return annotation;
    const extracted = await pageText(annotation.fileId, annotation.pageNumber).catch(error => {
        if (workspace.isCurrent(session)) throw error; return null;
    });
    if (!extracted || !workspace.isCurrent(session)) return annotation;
    const { characters } = extracted;
    if (!workspace.isCurrent(session)) return annotation;
    const quote = extractText(characters, annotation.rectangles);
    // The page may have changed while PDF extraction was awaiting a worker.
    const current = data.get(id), next = annotationData(id, current.attributes, current.excerpt);
    if (current.attributes.deleted) throw new LabloomError({ kind: "page-deleted" });
    if (next.fileId !== annotation.fileId || JSON.stringify(next.rectangles) !== JSON.stringify(annotation.rectangles) || next.pageNumber !== annotation.pageNumber) return getAnnotation(id);
    edits.cacheAttributes(id, { annotation_quote: quote, annotation_context: quote, annotation_extractor: PDF_EXTRACTOR_VERSION });
    return { ...next, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION };
}

export function annotationPaper(id: string): AnnotationPaper | null {
    if (data.header(id).kind !== "annotation") throw new LabloomError({ kind: "annotation-unavailable" });
    const owner = data.statement(`SELECT p.id,knowledge_text(b.type,b.content) AS title,d.value AS recycled
        FROM link_refs l CROSS JOIN pages p ON p.id=l.source_id AND p.kind='paper'
        JOIN blocks b ON b.id=p.title_block_id JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted'
        WHERE l.target_kind='page' AND l.target_id=? AND l.source_kind='page' AND l.source_field='paper_annotations'`).get(id) as
        { id: string; title: string; recycled: number } | undefined;
    return owner ? { ...owner, recycled: !!owner.recycled } : null;
}

export async function resources(pageId: string, fileId?: string): Promise<PaperResources> {
    const session = workspace.requireWorkspace();
    const page = paper(pageId), localFiles = files(page.attributes.paper_files as string[]);
    const available = localFiles.filter(file => file.mediaType === "application/pdf" && (!fileId || file.id === fileId)).map(file => file.id);
    const members = page.attributes.paper_annotations as string[];
    if (!members.length || !available.length) return { files: localFiles, annotations: [] };
    const stored = data.statement(`SELECT a.id, a.children, d.value AS deleted FROM json_each(?) j JOIN pages a ON a.id=j.value AND a.kind='annotation'
        JOIN page_attrs d ON d.page_id=a.id AND d.attr_id='deleted'
        JOIN page_attrs f ON f.page_id=a.id AND f.attr_id='annotation_file'
        LEFT JOIN page_attrs r ON r.page_id=a.id AND r.attr_id='recycle_reason'
        WHERE f.value IN (SELECT value FROM json_each(?)) AND (d.value=0 OR (?=1 AND r.value='unreachable'))
        ORDER BY j.key`).all(JSON.stringify(members), JSON.stringify(available), Number(!!page.attributes.deleted)) as { id: string; children: string; deleted: number }[];
    const values = data.valuesFor(stored.map(row => row.id));
    const excerpts = data.bodyExcerpts(stored.map(row => ({ id: row.id, children: JSON.parse(row.children) as string[] })));
    const annotations: PaperAnnotation[] = [];
    for (const { id, deleted } of stored) {
        if (!workspace.isCurrent(session)) return { files: localFiles, annotations };
        const entry = annotationData(id, values.get(id)!, excerpts.get(id) ?? "");
        if (deleted || entry.extractorVersion === PDF_EXTRACTOR_VERSION) {
            annotations.push(entry);
            continue;
        }
        try {
            annotations.push(await getAnnotation(id));
        }
        catch (error) {
            if (!workspace.isCurrent(session)) return { files: localFiles, annotations };
            if (["pdf-password-required", "pdf-password-incorrect"].includes(toFailureInfo(error).kind)) annotations.push({ ...entry, quote: "", context: "" });
            else if (toFailureInfo(error).kind === "page-deleted" || toFailureInfo(error).kind === "page-unavailable") continue;
            else throw error;
        }
    }
    return { files: localFiles, annotations };
}

function checkSelection(pageId: string, value: AnnotationInput): void {
    paper(pageId, true);
    if (!record(value) || !validUUID(value.fileId) || !Number.isInteger(value.pageNumber) || value.pageNumber < 1 || !Array.isArray(value.rectangles) || !value.rectangles.length || typeof value.quote !== "string" || typeof value.context !== "string" || typeof value.extractorVersion !== "string") throw new LabloomError({ kind: "annotation-invalid-input" });
    const file = paperFiles(pageId).find(file => file.id === value.fileId);
    if (!file) throw new LabloomError({ kind: "paper-file-removed" });
    if (file.mediaType !== "application/pdf") throw new LabloomError({ kind: "attachment-pdf-required" });
}

export async function prepareAnnotation(pageId: string, input: AnnotationInput | string): Promise<boolean> {
    const session = workspace.requireWorkspace();
    try {
        if (typeof input === "string") {
            if (!(paper(pageId, true).attributes.paper_annotations as string[]).includes(input)) throw new LabloomError({ kind: "annotation-unavailable" });
            await getAnnotation(input);
        }
        else {
            checkSelection(pageId, input);
            await pageText(input.fileId, input.pageNumber);
        }
        return workspace.isCurrent(session);
    }
    catch (error) {
        if (workspace.isCurrent(session)) throw error;
        return false;
    }
}

function selectionFromCache(value: AnnotationInput): AnnotationInput {
    const text = extracted.get(value.fileId + ":" + value.pageNumber);
    if (!text || text instanceof Promise) throw new LabloomError({ kind: "annotation-invalid-input" });
    const { bounds, characters } = text;
    for (const rect of value.rectangles) if (!record(rect) || !rectangleWithinPage(rect, bounds)) throw new LabloomError({ kind: "annotation-outside-page" });
    const rectangles = value.rectangles.map(({ x, y, width, height }) => ({ x, y, width, height })), quote = extractText(characters, rectangles);
    return { fileId: value.fileId, pageNumber: value.pageNumber, rectangles, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION };
}

export function changeAnnotation(id: string, color: string, source: HistorySource): CommitResult {
    workspace.requireWorkspace();
    if (!Object.hasOwn(annotationColors, color)) throw new LabloomError({ kind: "annotation-invalid-color" });
    if (data.header(id).kind !== "annotation") throw new LabloomError({ kind: "annotation-unavailable" });
    return edits.commitEdit({ pageId: id, batch: 0, blocks: [], attributes: { annotation_color: color } }, source);
}

export function deleteAnnotation(id: string, source: HistorySource, confirmation?: string): CommitResult {
    workspace.requireWorkspace();
    if (data.header(id).kind !== "annotation") throw new LabloomError({ kind: "annotation-unavailable" });
    return edits.trash([id], source, confirmation);
}

export function annotate(pageId: string, input: AnnotationInput, source: HistorySource, color = "yellow"): string {
    workspace.requireWorkspace();
    if (!Object.hasOwn(annotationColors, color)) throw new LabloomError({ kind: "annotation-invalid-color" });
    return commit.run({ history: false }, () => {
        checkSelection(pageId, input);
        const prepared = selectionFromCache(input);
        const localPosition = { page: prepared.pageNumber, rects: prepared.rectangles };
        return edits.createPage("annotation", [...prepared.quote].slice(0, 70).join(""), {
            annotation_file: prepared.fileId, annotation_position: localPosition, annotation_color: color,
            annotation_quote: prepared.quote, annotation_context: prepared.context, annotation_extractor: PDF_EXTRACTOR_VERSION
        }, pageId, source).id;
    });
}

export function position(pageId: string, fileId: string, position: ReadingPosition): void {
    workspace.requireWorkspace();
    commit.run({ history: false, updateModified: false }, context => {
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
export function fileSelection(attributeId: string): boolean {
    workspace.requireWorkspace();
    const definition = attributes.definition(attributeId);
    if (definition.type !== "file" && definition.type !== "files") throw new LabloomError({ kind: "attribute-file-required" });
    return definition.type === "files";
}