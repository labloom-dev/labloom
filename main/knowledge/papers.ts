import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { and, eq } from "drizzle-orm";
import { record, validUUID } from "../../shared/attrs/values";
import { payload } from "../../shared/content/blocks";
import { rectangleWithinPage } from "../../shared/content/anchors";
import { charactersFromTextContent, extractText, PDF_EXTRACTOR_VERSION, type PdfCharacter } from "../../shared/content/pdf-text";
import { type Anchor, type AnchorInput, type PaperImport, type PaperResources, type ReadingPosition } from "../../shared/types/papers";
import { type AttributeValue } from "../../shared/types/attributes";
import { type CommitResult, type PageRecord } from "../../shared/types/content";
import { EditChanges } from "./changes";
import { fingerprint } from "./attributes";
import { anchors, attachments, highlights, pageAttachments, pages } from "../storage/tables";
import { KnowledgeService } from "./service";

const digest = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
export class PaperService {
    private readonly documents = new Map<string, Promise<PDFDocumentProxy>>();
    private readonly extracted = new Map<string, Promise<{ bounds: number[]; characters: PdfCharacter[] }>>();
    constructor(readonly knowledge: KnowledgeService, readonly root: string) {}

    private async pageText(fileId: string, pageNumber: number): Promise<{ bounds: number[]; characters: PdfCharacter[] }> {
        // Check immutable bytes even when a document/page is already cached.
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
                if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > loaded.numPages) throw new Error("原文页码超出文献范围。");
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
            throw error;
        }
    }

    /** Only a successfully unlocked in-memory document is retained; passwords are never persisted. */
    async unlockPDF(fileId: string, password: string): Promise<void> {
        if (typeof password !== "string" || password.length > 10000) throw new Error("PDF 密码无效。");
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
        if (page.kind !== "paper" || (writable && page.attributes.deleted)) throw new Error("文献页面不可用。");
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

    hasPDF(pageId: string): boolean {
        return Boolean(this.knowledge.db.select({ id: attachments.id }).from(pageAttachments)
            .innerJoin(attachments, eq(pageAttachments.fileId, attachments.id))
            .where(and(eq(pageAttachments.pageId, pageId), eq(attachments.mediaType, "application/pdf"))).limit(1).get());
    }

    matchingPaper(path: string): { id: string; title: string } | null {
        const db = this.knowledge.db;
        const file = db.select().from(attachments).where(eq(attachments.sha256, digest(readFileSync(path)))).get();
        if (!file) return null;
        for (const owner of db.select().from(pageAttachments).where(eq(pageAttachments.fileId, file.id)).all()) {
            const page = this.knowledge.get(owner.pageId);
            if (!page.attributes.deleted) return { id: page.id, title: page.title || "未命名文献" };
        }
        return null;
    }

    importFile(path: string, pageId?: string, reusePageId?: string): PaperImport {
        if (pageId) this.paper(pageId, true);
        const data = readFileSync(path);
        if (!data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("请选择 PDF 文件。");
        const db = this.knowledge.db, hash = digest(data);
        const existing = db.select().from(attachments).where(eq(attachments.sha256, hash)).all().find(file => file.size === data.length);
        if (reusePageId) {
            if (!existing || !db.select().from(pageAttachments).where(and(eq(pageAttachments.fileId, existing.id), eq(pageAttachments.pageId, reusePageId))).get()) throw new Error("文件或文献关联已发生变化，请重新选择。");
            this.paper(reusePageId, true);
            this.read(existing.id);
            return { pageId: reusePageId, reused: true };
        }
        let createdFile: string | undefined;
        try {
            return db.$client.transaction(() => {
                const file = existing ?? { id: randomUUID(), storedName: `${randomUUID()}.pdf`, originalName: basename(path), mediaType: "application/pdf", size: data.length, sha256: hash };
                if (!existing) {
                    mkdirSync(join(this.root, "attachments"), { recursive: true });
                    const target = join(this.root, "attachments", file.storedName);
                    writeFileSync(target, data, { flag: "wx" });
                    createdFile = target;
                    db.insert(attachments).values(file).run();
                }
                else this.read(existing.id); // Never silently adopt changed bytes under an old identity.
                const page = pageId ? this.paper(pageId, true) : this.knowledge.create("paper", basename(path).replace(/\.pdf$/i, ""), { source_snapshot: { originalName: basename(path), sha256: hash } });
                const position = db.select().from(pageAttachments).where(eq(pageAttachments.pageId, page.id)).all().length;
                db.insert(pageAttachments).values({ pageId: page.id, fileId: file.id, role: "fulltext", position }).onConflictDoNothing().run();
                this.knowledge.touch(page.id);
                return { pageId: page.id, reused: false };
            })();
        }
        catch (error) {
            if (createdFile) unlinkSync(createdFile);
            throw error;
        }
    }

    read(id: string): Uint8Array {
        if (!validUUID(id)) throw new Error("附件标识无效。");
        const file = this.knowledge.db.select().from(attachments).where(eq(attachments.id, id)).get();
        if (!file || basename(file.storedName) !== file.storedName || !/^[a-zA-Z0-9-]+\.pdf$/.test(file.storedName)) throw new Error("附件不可用。");
        let data: Buffer;
        try {
            data = readFileSync(join(this.root, "attachments", file.storedName));
        }
        catch {
            throw new Error("附件文件缺失或无法读取；原定位与批注仍保留。");
        }
        if (data.length !== file.size || digest(data) !== file.sha256) throw new Error("附件字节已改变，不能将原锚点套用到替换文件。请导入为新附件。");
        return new Uint8Array(data);
    }

    async resources(pageId: string): Promise<PaperResources> {
        this.paper(pageId);
        const db = this.knowledge.db;
        const relations = db.select().from(pageAttachments).where(eq(pageAttachments.pageId, pageId)).all().sort((a, b) => a.position - b.position);
        const files = relations.map(row => db.select().from(attachments).where(eq(attachments.id, row.fileId)).get()!).map(({ storedName: _name, ...file }) => file);
        const ids = new Set(files.map(file => file.id));
        const matching = await Promise.all(db.select().from(anchors).all().filter(anchor => ids.has(anchor.fileId)).map(async anchor => {
            try {
                return await this.refreshAnchor(anchor);
            }
            catch (error) {
                // Let the reader prompt for the password before a stale encrypted cache is refreshed.
                if (error instanceof Error && error.name === "PasswordException") return { ...anchor, quote: "", context: "" };
                throw error;
            }
        }));
        const anchorIds = new Set(matching.map(anchor => anchor.id));
        const marks = db.select().from(highlights).all().filter(item => anchorIds.has(item.anchorId));
        return { files, anchors: matching, highlights: marks.map(mark => ({ ...mark, annotationId: this.annotation(mark.anchorId, pageId)?.id })) };
    }

    private annotation(anchorId: string, paperId?: string): PageRecord | undefined {
        const ids = this.knowledge.statement("SELECT page_id FROM page_attrs WHERE attr_id='annotation_anchor' AND value=?").pluck().all(anchorId) as string[];
        return ids.map(id => this.knowledge.get(id)).find(page => !page.attributes.deleted && (!paperId || page.attributes.annotation_paper === paperId));
    }

    async getAnchor(id: string): Promise<Anchor> {
        if (!validUUID(id)) throw new Error("锚点标识无效。");
        const anchor = this.knowledge.db.select().from(anchors).where(eq(anchors.id, id)).get();
        if (!anchor) throw new Error("原文定位不可用。");
        return this.refreshAnchor(anchor);
    }

    private async refreshAnchor(anchor: Anchor): Promise<Anchor> {
        if (anchor.extractorVersion === PDF_EXTRACTOR_VERSION) return anchor;
        const { characters } = await this.pageText(anchor.fileId, anchor.pageNumber);
        const quote = extractText(characters, anchor.rectangles);
        const cache = { quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION };
        this.knowledge.db.update(anchors).set(cache).where(eq(anchors.id, anchor.id)).run();
        return { ...anchor, ...cache };
    }

    private async prepareAnchor(pageId: string, input: AnchorInput | string): Promise<AnchorInput> {
        this.paper(pageId, true);
        const value = typeof input === "string" ? await this.getAnchor(input) : input;
        if (!record(value) || !validUUID(value.fileId) || !Number.isInteger(value.pageNumber) || value.pageNumber < 1 || !Array.isArray(value.rectangles) || !value.rectangles.length || value.rectangles.length > 500 || typeof value.quote !== "string" || value.quote.length > 100000 || typeof value.context !== "string" || value.context.length > 100000 || typeof value.extractorVersion !== "string" || value.extractorVersion.length > 200) throw new Error("原文定位无效。");
        const db = this.knowledge.db;
        if (!db.select().from(pageAttachments).where(and(eq(pageAttachments.pageId, pageId), eq(pageAttachments.fileId, value.fileId))).get()) throw new Error("锚点不属于此文献附件。");
        const { bounds, characters } = await this.pageText(value.fileId, value.pageNumber);
        for (const rect of value.rectangles) if (!record(rect) || !rectangleWithinPage(rect, bounds)) throw new Error("原文矩形超出页面范围。");
        const rectangles = value.rectangles.map(({ x, y, width, height }) => ({ x, y, width, height }));
        const quote = extractText(characters, rectangles);
        return { fileId: value.fileId, pageNumber: value.pageNumber, rectangles, quote, context: quote, extractorVersion: PDF_EXTRACTOR_VERSION };
    }

    private anchor(input: AnchorInput): string {
        const db = this.knowledge.db;
        const matching = db.select().from(anchors).where(and(eq(anchors.fileId, input.fileId), eq(anchors.pageNumber, input.pageNumber))).all().find(anchor => JSON.stringify(anchor.rectangles) === JSON.stringify(input.rectangles));
        if (matching) {
            db.update(anchors).set({ quote: input.quote, context: input.context, extractorVersion: input.extractorVersion }).where(eq(anchors.id, matching.id)).run();
            return matching.id;
        }
        const id = randomUUID();
        db.insert(anchors).values({ ...input, id }).run();
        return id;
    }

    private color(color: string): void {
        if (!["#F2D675", "#A9C5A0", "#C5B6DC", "#F1B6A7"].includes(color)) throw new Error("不支持的高亮颜色。");
    }

    async mark(pageId: string, input: AnchorInput, color: string): Promise<void> {
        this.color(color);
        const prepared = await this.prepareAnchor(pageId, input);
        this.knowledge.db.$client.transaction(() => {
            this.paper(pageId, true);
            const anchorId = this.anchor(prepared);
            this.knowledge.db.insert(highlights).values({ id: randomUUID(), anchorId, color }).run();
        })();
    }

    highlightOwners(id: string): string[] {
        if (!validUUID(id)) throw new Error("高亮标识无效。");
        const owners = this.knowledge.statement("SELECT DISTINCT p.page_id FROM highlights h JOIN anchors a ON a.id=h.anchor_id JOIN page_attachments p ON p.file_id=a.file_id WHERE h.id=?").pluck().all(id) as string[];
        if (!owners.length) throw new Error("高亮不可用。");
        return owners;
    }

    changeHighlight(id: string, color: string): void {
        this.color(color);
        const owners = this.highlightOwners(id);
        if (!owners.some(owner => !this.paper(owner).attributes.deleted)) throw new Error("回收站中的高亮不能编辑。");
        this.knowledge.db.update(highlights).set({ color }).where(eq(highlights.id, id)).run();
    }

    removeHighlight(id: string, tabId: string, confirmation?: string): CommitResult {
        const knowledge = this.knowledge;
        return knowledge.transact(tabId, () => {
            const owners = this.highlightOwners(id), mark = knowledge.db.select().from(highlights).where(eq(highlights.id, id)).get()!;
            const annotationIds = knowledge.statement("SELECT page_id FROM page_attrs WHERE attr_id='annotation_anchor' AND value=?").pluck().all(mark.anchorId) as string[];
            const plan = new EditChanges(knowledge), annotations = new Set(annotationIds);
            const activeOwners = owners.filter(owner => !this.paper(owner).attributes.deleted);
            if (!activeOwners.length) throw new Error("回收站中的高亮不能编辑。");
            for (const owner of activeOwners) {
                const paper = this.paper(owner);
                const removed = new Set(Object.values(paper.blocks).filter(block => block.type === "blocked_reference" && block.payload.target?.kind === "page" && annotations.has(block.payload.target.id)).map(block => block.id));
                plan.pageChildren(owner, paper.children.filter(block => !removed.has(block)));
                for (const block of Object.values(paper.blocks)) if (block.children.some(child => removed.has(child))) plan.putBlock({ ...block, children: block.children.filter(child => !removed.has(child)) });
                plan.pages.add(owner);
                plan.touches.add(owner);
            }
            plan.setHighlight(id, null, mark);
            plan.verifyContainment();
            const lost = plan.lostPages(), named = lost.map(pageId => ({ id: pageId, title: knowledge.title(pageId) }));
            const preview = named.length || annotationIds.length ? { token: fingerprint({ highlight: id, rows: plan.rows.after, lost }), recycled: named,
                direct: named.filter(page => plan.direct.has(page.id)), causes: [...plan.causes],
                deletedBlocks: [{ id, excerpt: "这条高亮", pages: 0, positions: 0, links: 0 }] } : null;
            return knowledge.finish(plan, activeOwners[0], tabId, 0, preview, confirmation);
        });
    }

    async annotate(pageId: string, input: AnchorInput | string, color = "#F2D675"): Promise<string> {
        this.color(color);
        const prepared = await this.prepareAnchor(pageId, input), db = this.knowledge.db;
        return db.$client.transaction(() => {
            this.paper(pageId, true);
            const anchorId = this.anchor(prepared);
            if (!db.select().from(highlights).where(eq(highlights.anchorId, anchorId)).get()) db.insert(highlights).values({ id: randomUUID(), anchorId, color }).run();
            const existing = this.annotation(anchorId, pageId);
            if (existing) return existing.id;
            const annotation = this.knowledge.create("annotation", prepared.quote.slice(0, 70), { annotation_paper: pageId, annotation_anchor: anchorId }, pageId);
            const sourceId = randomUUID();
            this.knowledge.putBlock({ id: sourceId, type: "source", payload: { ...payload("source"), source: { anchorId } }, children: [] });
            db.update(pages).set({ children: [sourceId, ...annotation.children] }).where(eq(pages.id, annotation.id)).run();
            this.knowledge.onInvalidated?.([`page:${pageId}`]);
            return annotation.id;
        })();
    }

    position(pageId: string, fileId: string, position: ReadingPosition): void {
        const page = this.paper(pageId, true);
        if (!this.knowledge.db.select().from(pageAttachments).where(and(eq(pageAttachments.pageId, pageId), eq(pageAttachments.fileId, fileId))).get() || !record(position) || !Number.isInteger(position.page) || position.page < 1 || ![0, 90, 180, 270].includes(position.rotation) || !Number.isFinite(position.left) || !Number.isFinite(position.top) || !(typeof position.scale === "number" && position.scale > 0 && position.scale <= 10 || ["auto", "page-width", "page-fit", "page-actual"].includes(String(position.scale)))) throw new Error("阅读位置无效。");
        this.knowledge.attributes.write(pageId, { reading_position: { ...(record(page.attributes.reading_position) ? page.attributes.reading_position : {}), [fileId]: position as unknown as AttributeValue } }, true);
    }
}