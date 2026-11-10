import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { record, validUUID } from "../../shared/attrs/values";
import { payload } from "../../shared/content/blocks";
import { type AnchorInput, type PaperImport, type PaperResources, type ReadingPosition } from "../../shared/types/papers";
import { type AttributeValue } from "../../shared/types/attributes";
import { type PageRecord } from "../../shared/types/content";
import { anchors, attachments, highlights, pageAttachments, pages } from "../storage/tables";
import { KnowledgeService } from "./service";

const digest = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
export class PaperService {
    constructor(readonly knowledge: KnowledgeService, readonly root: string) {}

    private paper(id: string, writable = false): PageRecord {
        const page = this.knowledge.get(id);
        if (page.kind !== "paper" || (writable && page.attributes.deleted)) throw new Error("文献页面不可用。");
        return page;
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

    resources(pageId: string): PaperResources {
        this.paper(pageId);
        const db = this.knowledge.db;
        const relations = db.select().from(pageAttachments).where(eq(pageAttachments.pageId, pageId)).all().sort((a, b) => a.position - b.position);
        const files = relations.map(row => db.select().from(attachments).where(eq(attachments.id, row.fileId)).get()!).map(({ storedName: _name, ...file }) => file);
        const ids = new Set(files.map(file => file.id));
        const matching = db.select().from(anchors).all().filter(anchor => ids.has(anchor.fileId));
        const anchorIds = new Set(matching.map(anchor => anchor.id));
        return { files, anchors: matching, highlights: db.select().from(highlights).all().filter(item => anchorIds.has(item.anchorId)) };
    }

    private anchor(pageId: string, input: AnchorInput): string {
        this.paper(pageId, true);
        if (!record(input) || !validUUID(input.fileId) || !Number.isInteger(input.pageNumber) || input.pageNumber < 1 || !Array.isArray(input.rectangles) || !input.rectangles.length || input.rectangles.length > 500 || typeof input.quote !== "string" || input.quote.length > 100000 || typeof input.context !== "string" || input.context.length > 100000) throw new Error("原文定位无效。");
        for (const rect of input.rectangles) if (!record(rect) || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) throw new Error("原文矩形超出页面范围。");
        const db = this.knowledge.db;
        if (!db.select().from(pageAttachments).where(and(eq(pageAttachments.pageId, pageId), eq(pageAttachments.fileId, input.fileId))).get()) throw new Error("锚点不属于此文献附件。");
        this.read(input.fileId);
        const matching = db.select().from(anchors).where(and(eq(anchors.fileId, input.fileId), eq(anchors.pageNumber, input.pageNumber))).all().find(anchor => anchor.quote === input.quote && anchor.context === input.context && JSON.stringify(anchor.rectangles) === JSON.stringify(input.rectangles));
        if (matching) return matching.id;
        const id = randomUUID();
        db.insert(anchors).values({ ...input, id }).run();
        return id;
    }

    mark(pageId: string, input: AnchorInput, color: string): void {
        if (!["#F2D675", "#A9C5A0", "#C5B6DC", "#F1B6A7"].includes(color)) throw new Error("不支持的高亮颜色。");
        this.knowledge.db.$client.transaction(() => {
            const anchorId = this.anchor(pageId, input);
            this.knowledge.db.insert(highlights).values({ id: randomUUID(), anchorId, color }).run();
        })();
    }

    removeHighlight(id: string): string[] {
        if (!validUUID(id)) throw new Error("高亮标识无效。");
        return this.knowledge.sql.transaction(() => {
            const owners = this.knowledge.statement("SELECT DISTINCT p.page_id FROM highlights h JOIN anchors a ON a.id=h.anchor_id JOIN page_attachments p ON p.file_id=a.file_id WHERE h.id=?").pluck().all(id) as string[];
            this.knowledge.db.delete(highlights).where(eq(highlights.id, id)).run();
            return owners;
        })();
    }

    annotate(pageId: string, input: AnchorInput): string {
        const db = this.knowledge.db;
        return db.$client.transaction(() => {
            const anchorId = this.anchor(pageId, input);
            const annotation = this.knowledge.create("annotation", input.quote.slice(0, 70), { annotation_paper: pageId, annotation_anchor: anchorId }, pageId);
            const sourceId = randomUUID();
            this.knowledge.putBlock({ id: sourceId, type: "source", payload: { ...payload("source"), source: { fileId: input.fileId, anchorId, quote: input.quote } }, children: [] });
            db.update(pages).set({ children: [sourceId, ...annotation.children] }).where(eq(pages.id, annotation.id)).run();
            this.knowledge.onInvalidated?.([`page:${pageId}`]);
            return annotation.id;
        })();
    }

    position(pageId: string, fileId: string, position: ReadingPosition): void {
        const page = this.paper(pageId, true);
        if (!this.resources(pageId).files.some(file => file.id === fileId) || !record(position) || !Number.isInteger(position.page) || position.page < 1 || ![0, 90, 180, 270].includes(position.rotation) || !Number.isFinite(position.left) || !Number.isFinite(position.top) || !(typeof position.scale === "number" && position.scale > 0 && position.scale <= 10 || ["auto", "page-width", "page-fit", "page-actual"].includes(String(position.scale)))) throw new Error("阅读位置无效。");
        this.knowledge.attributes.write(pageId, { reading_position: { ...(record(page.attributes.reading_position) ? page.attributes.reading_position : {}), [fileId]: position as unknown as AttributeValue } }, true);
    }
}