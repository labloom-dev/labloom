import { LabloomError, diagnostic, toFailureInfo } from "../../shared/failure";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { eq, inArray } from "drizzle-orm";
import { record, validUUID } from "../../shared/attrs/values";
import { annotationColors, type AnnotationColor } from "../../shared/content/annotations";
import { rectangleWithinPage } from "../../shared/content/anchors";
import { charactersFromTextContent, extractText, PDF_EXTRACTOR_VERSION, type PdfCharacter } from "../../shared/content/pdf-text";
import { type PaperAnnotation, type AnnotationInput, type Attachment, type PaperImport, type PaperResources, type ReadingPosition } from "../../shared/types/papers";
import { type AttributeValue } from "../../shared/types/attributes";
import { type CommitResult, type PageRecord } from "../../shared/types/content";
import { attachments } from "../storage/tables";
import { attachmentPath } from "../storage/files";
import { KnowledgeService } from "./service";

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
export class PaperService {
    private readonly documents = new Map<string, Promise<PDFDocumentProxy>>();
    private readonly extracted = new Map<string, Promise<{ bounds: number[]; characters: PdfCharacter[] }>>();
    constructor(readonly knowledge: KnowledgeService, readonly root: string) {}

    private async pageText(fileId: string, pageNumber: number): Promise<{ bounds: number[]; characters: PdfCharacter[] }> {
        // Check the managed file size even when the parsed document/page is already cached.
        this.requirePDF(fileId);
        const data = this.read(fileId), key = `${fileId}:${pageNumber}`;
        let document = this.documents.get(fileId);
        if (!document) {
            document = this.loadPDF(data);
            this.documents.set(fileId, document);
            void document.catch(() => this.documents.delete(fileId));
        }
        let result = this.extracted.get(key);
        if (!result) {
            result = (async () => {
                const loaded = await document;
                if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > loaded.numPages) throw new LabloomError({ kind: "pdf-page-range" });
                const page = await loaded.getPage(pageNumber), content = await page.getTextContent();
                return { bounds: page.view, characters: charactersFromTextContent(content) };
            })();
            this.extracted.set(key, result);
            void result.catch(() => this.extracted.delete(key));
        }
        return result;
    }

    private async loadPDF(data: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const require = createRequire(join(process.cwd(), "package.json"));
        // import.meta.resolve is available in the app; bundled CJS tests use their project directory.
        const packageFile = typeof import.meta.resolve === "function" ? fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")) : require.resolve("pdfjs-dist/package.json");
        const assets = dirname(packageFile);
        const task = getDocument({ data, password, disableFontFace: true, useSystemFonts: false,
            cMapUrl: `${assets}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}/standard_fonts/`,
            wasmUrl: `${assets}/wasm/` });
        try {
            return await task.promise;
        }
        catch (error) {
            await task.destroy();
            throw new LabloomError(toFailureInfo(error), { cause: error });
        }
    }

    /** Only a successfully unlocked in-memory document is retained; passwords are never persisted. */
    async unlockPDF(fileId: string, password: string): Promise<void> {
        if (typeof password !== "string" || password.length > 10000) throw new LabloomError({ kind: "pdf-invalid-password" });
        this.requirePDF(fileId);
        const document = await this.loadPDF(this.read(fileId), password);
        const existing = await this.documents.get(fileId)?.catch(() => null);
        if (existing) {
            await document.loadingTask.destroy();
            return;
        }
        this.documents.set(fileId, Promise.resolve(document));
        for (const key of this.extracted.keys()) if (key.startsWith(fileId + ":")) this.extracted.delete(key);
    }

    private paper(id: string, writable = false): PageRecord {
        const page = this.knowledge.get(id);
        if (page.kind !== "paper" || (writable && page.attributes.deleted)) throw new LabloomError({ kind: "paper-unavailable" });
        return page;
    }

    /** Creates a paper known only by its bibliographic data, such as a subscription item. Joins the caller's transaction. */
    createReference(paper: { title: string; authors: string; url: string | null; abstract: string; published: string | null; origin: Record<string, string | null> }): string {
        return this.knowledge.create("paper", paper.title.slice(0, 1000), {
            paper_authors: paper.authors, paper_url: paper.url ?? "", paper_abstract: paper.abstract, paper_year: paper.published ?? "", source_snapshot: paper.origin
        }).id;
    }

    /** Whether a paper page is still in the library, in the recycle bin, or gone. */
    state(id: string): "saved" | "recycled" | "missing" {
        if (!this.knowledge.statement("SELECT 1 FROM pages WHERE id=? AND kind='paper'").get(id)) return "missing";
        return this.knowledge.flags(id).deleted ? "recycled" : "saved";
    }

    files(ids?: string[]): Attachment[] {
        if (ids !== undefined && (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => !validUUID(id)))) throw new LabloomError({ kind: "attachment-invalid-list" });
        if (ids && !ids.length) return [];
        const rows = this.knowledge.db.select().from(attachments).where(ids ? inArray(attachments.id, ids) : undefined).all();
        const byId = new Map(rows.map(file => [file.id, file]));
        const files = ids ? ids.map(id => byId.get(id)).filter(file => file !== undefined) : rows;
        return files.map(({ storedName: _name, ...file }) => file);
    }

    private paperFiles(pageId: string): Attachment[] {
        return this.files(this.paper(pageId).attributes.paper_files as string[]);
    }

    private requirePDF(id: string): void {
        if (this.files([id])[0]?.mediaType !== "application/pdf") throw new LabloomError({ kind: "attachment-pdf-required" });
    }

    hasPDF(pageId: string): boolean {
        return Boolean(this.knowledge.statement(`SELECT 1 FROM page_attrs p JOIN pages ON pages.id=p.page_id
            JOIN json_each(p.value) f JOIN attachments a ON a.id=f.value
            WHERE p.page_id=? AND p.attr_id='paper_files' AND pages.kind='paper' AND a.media_type='application/pdf' LIMIT 1`).get(pageId));
    }

    private importing<T>(action: (store: (path: string) => Attachment) => T): T {
        const created: string[] = [], db = this.knowledge.db;
        try {
            return this.knowledge.transaction(() => action(path => {
                const data = readFileSync(path), suffix = extname(path), type = mediaType(path);
                if (type === "application/pdf" && !data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new LabloomError({ kind: "pdf-invalid" });
                const id = randomUUID(), file = { id, storedName: id + suffix, originalName: basename(path), mediaType: type, size: data.length };
                const target = attachmentPath(this.root, file.storedName);
                mkdirSync(join(this.root, "attachments"), { recursive: true });
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

    private append(pageId: string, attributeId: string, files: Attachment[], tabId?: string): void {
        const definition = this.knowledge.attributes.definition(attributeId), page = this.knowledge.get(pageId);
        if (definition.type !== "file" && definition.type !== "files") throw new LabloomError({ kind: "attribute-file-required" });
        if (definition.type === "file" && files.length !== 1) throw new LabloomError({ kind: "attribute-single-file" });
        const current = page.attributes[attributeId];
        const value = definition.type === "file" ? files[0].id : [...new Set([...(Array.isArray(current) ? current as string[] : []), ...files.map(file => file.id)])];
        const result = this.knowledge.commitEdit({ pageId, tabId: tabId ?? "file-import", batch: 0, blocks: [], attributes: { [attributeId]: value } });
        if (result.status !== "saved") throw new LabloomError({ kind: "attachment-write-failed" });
        if (!tabId) this.knowledge.invalidateHistory(["page:" + pageId]);
    }

    attachFiles(paths: string[], pageId: string, attributeId: string, tabId?: string): Attachment[] {
        if (!Array.isArray(paths) || !paths.length || paths.length > 10000) throw new LabloomError({ kind: "attachment-selection-required" });
        return this.importing(store => {
            const files = paths.map(store);
            this.append(pageId, attributeId, files, tabId);
            return files;
        });
    }

    importFile(path: string, pageId?: string, tabId?: string): PaperImport {
        if (pageId) this.paper(pageId, true);
        return this.importing(store => {
            const file = store(path);
            const page = pageId ? this.paper(pageId, true) : this.knowledge.create("paper", basename(path, extname(path)), { source_snapshot: { originalName: basename(path) } });
            this.append(page.id, "paper_files", [file], tabId);
            return { pageId: page.id };
        });
    }

    read(id: string): Uint8Array {
        if (!validUUID(id)) throw new LabloomError({ kind: "attachment-invalid-id" });
        const file = this.knowledge.db.select().from(attachments).where(eq(attachments.id, id)).get();
        if (!file) throw new LabloomError({ kind: "attachment-unavailable" });
        const path = attachmentPath(this.root, file.storedName);
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

    externalPath(id: string): string {
        this.read(id);
        const file = this.knowledge.db.select().from(attachments).where(eq(attachments.id, id)).get()!;
        return attachmentPath(this.root, file.storedName);
    }

    private annotationData(page: PageRecord): PaperAnnotation {
        const a = page.attributes, position = a.annotation_position;
        if (page.kind !== "annotation" || typeof a.annotation_file !== "string" || !record(position) || !Number.isInteger(position.page) || !Array.isArray(position.rects) || typeof a.annotation_color !== "string" || !Object.hasOwn(annotationColors, a.annotation_color)) throw new LabloomError({ kind: "annotation-invalid-position" });
        return { id: page.id, fileId: a.annotation_file, pageNumber: Number(position.page), rectangles: position.rects as PaperAnnotation["rectangles"],
            quote: String(a.annotation_quote), context: String(a.annotation_context), extractorVersion: String(a.annotation_extractor), color: a.annotation_color as AnnotationColor, hasText: !!page.excerpt.trim() };
    }

    async getAnnotation(id: string): Promise<PaperAnnotation> {
        const page = this.knowledge.get(id);
        if (page.attributes.deleted) throw new LabloomError({ kind: "page-deleted" });
        const annotation = this.annotationData(page);
        if (annotation.extractorVersion === PDF_EXTRACTOR_VERSION) return annotation;
        const { characters } = await this.pageText(annotation.fileId, annotation.pageNumber);
        const quote = extractText(characters, annotation.rectangles);
        // The page may have changed while PDF extraction was awaiting a worker.
        const current = this.knowledge.get(id), next = this.annotationData(current);
        if (current.attributes.deleted) throw new LabloomError({ kind: "page-deleted" });
        if (next.fileId !== annotation.fileId || JSON.stringify(next.rectangles) !== JSON.stringify(annotation.rectangles) || next.pageNumber !== annotation.pageNumber) return this.getAnnotation(id);
        this.knowledge.attributes.cache(id, { annotation_quote: quote, annotation_context: quote, annotation_extractor: PDF_EXTRACTOR_VERSION });
        return { ...next, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION };
    }

    async resources(pageId: string): Promise<PaperResources> {
        const page = this.paper(pageId), files = this.paperFiles(pageId), available = new Set(files.filter(file => file.mediaType === "application/pdf").map(file => file.id));
        const annotations: PaperAnnotation[] = [];
        for (const id of page.attributes.paper_annotations as string[]) {
            if (!this.knowledge.statement("SELECT 1 FROM pages WHERE id=? AND kind='annotation'").get(id) || this.knowledge.flags(id).deleted) continue;
            const record = this.knowledge.get(id);
            if (!available.has(String(record.attributes.annotation_file))) continue;
            try {
 annotations.push(await this.getAnnotation(id));
}
            catch (error) {
                if (["pdf-password-required", "pdf-password-incorrect"].includes(toFailureInfo(error).kind)) annotations.push({ ...this.annotationData(record), quote: "", context: "" });
                else throw error;
            }
        }
        return { files, annotations };
    }

    private async prepareAnnotation(pageId: string, value: AnnotationInput): Promise<AnnotationInput> {
        this.paper(pageId, true);
        if (!record(value) || !validUUID(value.fileId) || !Number.isInteger(value.pageNumber) || value.pageNumber < 1 || !Array.isArray(value.rectangles) || !value.rectangles.length || value.rectangles.length > 500 || typeof value.quote !== "string" || value.quote.length > 100000 || typeof value.context !== "string" || value.context.length > 100000 || typeof value.extractorVersion !== "string" || value.extractorVersion.length > 200) throw new LabloomError({ kind: "annotation-invalid-input" });
        const file = this.paperFiles(pageId).find(file => file.id === value.fileId);
        if (!file) throw new LabloomError({ kind: "paper-file-removed" });
        if (file.mediaType !== "application/pdf") throw new LabloomError({ kind: "attachment-pdf-required" });
        const { bounds, characters } = await this.pageText(value.fileId, value.pageNumber);
        for (const rect of value.rectangles) if (!record(rect) || !rectangleWithinPage(rect, bounds)) throw new LabloomError({ kind: "annotation-outside-page" });
        const rectangles = value.rectangles.map(({ x, y, width, height }) => ({ x, y, width, height })), quote = extractText(characters, rectangles);
        return { fileId: value.fileId, pageNumber: value.pageNumber, rectangles, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION };
    }

    changeAnnotation(id: string, color: string, tabId: string): CommitResult {
        if (!Object.hasOwn(annotationColors, color)) throw new LabloomError({ kind: "annotation-invalid-color" });
        if (this.knowledge.header(id).kind !== "annotation") throw new LabloomError({ kind: "annotation-unavailable" });
        return this.knowledge.commitEdit({ pageId: id, tabId, batch: 0, blocks: [], attributes: { annotation_color: color } });
    }

    deleteAnnotation(id: string, tabId: string, confirmation?: string): CommitResult {
        if (this.knowledge.header(id).kind !== "annotation") throw new LabloomError({ kind: "annotation-unavailable" });
        return this.knowledge.trash([id], tabId, confirmation);
    }

    async annotate(pageId: string, input: AnnotationInput | string, tabId: string, color = "yellow"): Promise<string> {
        if (!Object.hasOwn(annotationColors, color)) throw new LabloomError({ kind: "annotation-invalid-color" });
        if (typeof input === "string") {
            if (!(this.paper(pageId, true).attributes.paper_annotations as string[]).includes(input)) throw new LabloomError({ kind: "annotation-unavailable" });
            await this.getAnnotation(input);
            return input;
        }
        const prepared = await this.prepareAnnotation(pageId, input), knowledge = this.knowledge;
        return knowledge.transaction(() => {
            const paper = this.paper(pageId, true);
            if (!(paper.attributes.paper_files as string[]).includes(prepared.fileId)) throw new LabloomError({ kind: "paper-file-removed" });
            const position = { page: prepared.pageNumber, rects: prepared.rectangles };
            return knowledge.create("annotation", [...prepared.quote].slice(0, 70).join(""), {
                annotation_file: prepared.fileId, annotation_position: position, annotation_color: color,
                annotation_quote: prepared.quote, annotation_context: prepared.context, annotation_extractor: PDF_EXTRACTOR_VERSION
            }, pageId, tabId).id;
        });
    }

    position(pageId: string, fileId: string, position: ReadingPosition): void {
        const page = this.paper(pageId, true);
        if (!this.paperFiles(pageId).some(file => file.id === fileId && file.mediaType === "application/pdf") || !record(position) || !Number.isInteger(position.page) || position.page < 1 || ![0, 90, 180, 270].includes(position.rotation) || !Number.isFinite(position.left) || !Number.isFinite(position.top) || !(typeof position.scale === "number" && position.scale > 0 && position.scale <= 10 || ["auto", "page-width", "page-fit", "page-actual"].includes(String(position.scale)))) throw new LabloomError({ kind: "paper-invalid-position" });
        this.knowledge.attributes.write(pageId, { reading_position: { ...(record(page.attributes.reading_position) ? page.attributes.reading_position : {}), [fileId]: position as unknown as AttributeValue } }, true);
    }
}