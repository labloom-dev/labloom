import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type { AnnotationOrigin, Annotation, Attachment, PageRecord, PaperMetadata, ReadingPosition } from "../../shared/types/knowledge";
import { identifier, object, plainDocument, text, webURL } from "./document";
import { KnowledgeService } from "./service";

export const emptyPaper = (): PaperMetadata => ({ authors: "", doi: "", year: "", venue: "", url: "", abstract: "" });

export class PaperService {
    constructor(private readonly knowledge: KnowledgeService, private readonly root: string) {}

    importMetadata(title: string, metadata: PaperMetadata): PageRecord {
        const database = this.knowledge.database;
        const existing = database.prepare<{ doi: string; url: string }, { page_id: string }>(`SELECT d.page_id FROM page_details d JOIN pages p ON p.id = d.page_id
            JOIN page_attrs a ON a.page_id = p.id AND a.attr_id = 'deleted'
            WHERE p.kind = 'paper' AND COALESCE(a.value, 0) = 0
                AND ((@doi != '' AND lower(json_extract(d.paper, '$.doi')) = lower(@doi)) OR (@url != '' AND json_extract(d.paper, '$.url') = @url)) LIMIT 1`).get({ doi: metadata.doi, url: metadata.url });
        return existing ? this.knowledge.get(existing.page_id) : this.knowledge.create({ kind: "paper", title, paper: metadata });
    }

    importFeed(id: string): PageRecord {
        identifier(id);
        const row = this.knowledge.database.prepare<[string], { title: string; authors: string; url: string | null; summary: string; published_at: string | null }>("SELECT title, authors, url, summary, published_at FROM feed_items WHERE id = ?").get(id);
        if (!row) throw new Error("订阅条目不存在。");
        return this.importMetadata(row.title, { ...emptyPaper(), authors: row.authors, url: row.url ?? "", abstract: row.summary, year: row.published_at?.slice(0, 4) ?? "" });
    }

    importPDF(path: string, pageId?: string): PageRecord {
        const size = statSync(path).size;
        if (size > 100 * 1024 * 1024) throw new Error("单个 PDF 不能超过 100 MB。");
        const data = readFileSync(path);
        if (!data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("文件不是有效的 PDF。");
        const hash = createHash("sha256").update(data).digest("hex");
        const database = this.knowledge.database;
        const duplicate = database.prepare<[string], { page_id: string }>("SELECT page_id FROM attachments WHERE hash = ?").get(hash);
        if (duplicate) {
            const existing = this.knowledge.get(duplicate.page_id);
            if (!existing.deleted && (!pageId || pageId === existing.id)) return existing;
        }
        const id = randomUUID();
        const file = join(this.root, "attachments", `${id}.pdf`);
        const partial = `${file}.partial`;
        let wrote = false;
        try {
            writeFileSync(partial, data, { flag: "wx" });
            renameSync(partial, file);
            wrote = true;
            return database.transaction(() => {
                const page = pageId ? this.knowledge.get(pageId) : this.knowledge.create({ kind: "paper", title: basename(path).replace(/\.pdf$/i, ""), paper: emptyPaper() });
                if (page.kind !== "paper" || page.deleted) throw new Error("请选择未删除的文献页面。");
                const version = this.attachments(page.id).length + 1;
                database.prepare("INSERT INTO attachments (id, page_id, name, version, hash, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, page.id, basename(path), `v${version}`, hash, size, new Date().toISOString());
                return page;
            })();
        }
        catch (error) {
            try { unlinkSync(wrote ? file : partial); }
            catch { /* Preserve the import error. */ }
            throw error;
        }
    }

    attachments(pageId: string): Attachment[] {
        this.knowledge.get(pageId);
        return this.knowledge.database.prepare<[string], Attachment>("SELECT id, page_id AS pageId, name, version, size, created_at AS createdAt FROM attachments WHERE page_id = ? ORDER BY created_at DESC, rowid DESC").all(pageId);
    }

    readAttachment(id: string): Uint8Array {
        this.attachment(id);
        return new Uint8Array(readFileSync(join(this.root, "attachments", `${identifier(id)}.pdf`)));
    }

    getPosition(id: string): ReadingPosition | null {
        this.attachment(id);
        const row = this.knowledge.database.prepare<[string], { position: string | null }>("SELECT position FROM attachments WHERE id = ?").get(id)!;
        return row.position ? JSON.parse(row.position) : null;
    }

    setPosition(id: string, position: ReadingPosition): void {
        this.attachment(id);
        object(position);
        if (!Number.isInteger(position.pageNumber) || position.pageNumber < 1 || position.pageNumber > 100000
            || ![0, 90, 180, 270].includes(position.rotation)
            || (typeof position.scale === "number" ? !Number.isFinite(position.scale) || position.scale < 0.1 || position.scale > 20 : !["auto", "page-actual", "page-width", "page-fit"].includes(position.scale))
            || !Number.isFinite(position.left) || !Number.isFinite(position.top) || Math.abs(position.left) > 1000000 || Math.abs(position.top) > 1000000) throw new Error("无效的阅读位置。");
        this.knowledge.database.prepare("UPDATE attachments SET position = ? WHERE id = ?").run(JSON.stringify(position), id);
    }

    annotationOrigin(pageId: string): AnnotationOrigin | null {
        this.knowledge.get(pageId);
        return this.knowledge.database.prepare<[string], AnnotationOrigin>(`SELECT a.page_id AS paperId, b.content AS title, a.id AS attachmentId, a.version, n.page_number AS pageNumber
            FROM annotations n JOIN attachments a ON a.id = n.attachment_id JOIN pages p ON p.id = a.page_id JOIN blocks b ON b.id = p.title_block_id WHERE n.page_id = ?`).get(pageId) ?? null;
    }

    annotations(attachmentId: string): Annotation[] {
        this.attachment(attachmentId);
        return this.knowledge.database.prepare<[string], Omit<Annotation, "rects"> & { rects: string }>(`SELECT n.id, n.page_id AS pageId, n.attachment_id AS attachmentId, n.page_number AS pageNumber, n.quote, n.color, n.rects
            FROM annotations n JOIN page_attrs a ON a.page_id = n.page_id AND a.attr_id = 'deleted' WHERE n.attachment_id = ? AND COALESCE(a.value, 0) = 0 ORDER BY n.page_number, n.rowid`).all(attachmentId).map(row => ({ ...row, rects: JSON.parse(row.rects) }));
    }

    annotate(input: Omit<Annotation, "id" | "pageId">): Annotation {
        object(input);
        const attachment = this.attachment(input.attachmentId);
        if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1 || input.pageNumber > 100000) throw new Error("无效的批注页码。");
        const quote = text(input.quote, 10000);
        this.annotationColor(input.color);
        if (!Array.isArray(input.rects) || !input.rects.length || input.rects.length > 200) throw new Error("请选择一个原文区域。");
        for (const rect of input.rects) {
            object(rect);
            if (![rect.x, rect.y, rect.width, rect.height].every(value => typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1000000) || rect.width <= 0 || rect.height <= 0) throw new Error("无效的原文区域。");
        }
        return this.knowledge.database.transaction(() => {
            const page = this.knowledge.create({ kind: "annotation", title: quote ? quote.slice(0, 80) : `第 ${input.pageNumber} 页区域批注`, document: plainDocument(quote ? `原文：${quote}\n\n` : "") });
            const id = randomUUID();
            this.knowledge.database.prepare("INSERT INTO annotations (id, page_id, attachment_id, page_number, quote, color, rects) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, page.id, attachment.id, input.pageNumber, quote, input.color, JSON.stringify(input.rects));
            return { id, pageId: page.id, attachmentId: attachment.id, pageNumber: input.pageNumber, quote, color: input.color, rects: input.rects };
        })();
    }

    changeAnnotation(id: string, color: string): void {
        this.annotationColor(color);
        if (!this.knowledge.database.prepare("UPDATE annotations SET color = ? WHERE id = ?").run(color, identifier(id)).changes) throw new Error("批注不存在。");
    }

    private annotationColor(color: string): void {
        if (!["yellow", "green", "blue", "pink"].includes(color)) throw new Error("无效的标注颜色。");
    }

    private attachment(id: string): { id: string; page_id: string } {
        const row = this.knowledge.database.prepare<[string], { id: string; page_id: string }>("SELECT id, page_id FROM attachments WHERE id = ?").get(identifier(id));
        if (!row) throw new Error("附件不存在。");
        if (this.knowledge.get(row.page_id).deleted) throw new Error("文献已在回收站，请先恢复。");
        return row;
    }
}

export async function doiMetadata(doi: string, fetcher: typeof fetch = fetch): Promise<{ title: string; paper: PaperMetadata }> {
    doi = text(doi, 1000, false).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    if (!/^10\.\d{4,9}\/\S+$/i.test(doi)) throw new Error("请输入有效的 DOI，例如 10.1234/example。");
    const response = await fetcher(`https://doi.org/${encodeURIComponent(doi)}`, { headers: { Accept: "application/vnd.citationstyles.csl+json" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`DOI 元数据获取失败（HTTP ${response.status}）。`);
    const content = await response.text();
    if (content.length > 1024 * 1024) throw new Error("DOI 响应过大。");
    const data = object(JSON.parse(content));
    const title = typeof data.title === "string" ? data.title : "";
    if (!title) throw new Error("来源没有提供文献标题。");
    const authors = Array.isArray(data.author) ? data.author.map(value => {
        const author = object(value);
        return typeof author.literal === "string" ? author.literal : [author.given, author.family].filter(value => typeof value === "string").join(" ");
    }).join("; ") : "";
    const issued = data.issued && typeof data.issued === "object" ? (data.issued as Record<string, unknown>)["date-parts"] : undefined;
    const year = Array.isArray(issued) && Array.isArray(issued[0]) ? String(issued[0][0] ?? "") : "";
    const venue = typeof data["container-title"] === "string" ? data["container-title"] : "";
    return { title, paper: { authors, doi, year, venue, url: `https://doi.org/${doi}`, abstract: typeof data.abstract === "string" ? data.abstract.replace(/<[^>]*>/g, "") : "" } };
}

export function parseBibTeX(source: string): { title: string; paper: PaperMetadata }[] {
    text(source, 2 * 1024 * 1024);
    const results: { title: string; paper: PaperMetadata }[] = [];
    let index = 0;
    const skip = (): void => { while (index < source.length && /[\s,]/.test(source[index])) index++; };
    const read = (): string => {
        skip();
        const delimiter = source[index];
        if (delimiter === "{" || delimiter === '"') {
            index++;
            let depth = delimiter === "{" ? 1 : 0;
            let value = "";
            while (index < source.length) {
                const char = source[index++];
                if (char === "\\" && index < source.length) { value += char + source[index++]; continue; }
                if (delimiter === "{" && char === "{") depth++;
                if (delimiter === "{" && char === "}" && --depth === 0) return value;
                if (delimiter === '"' && char === '"') return value;
                value += char;
            }
            throw new Error("BibTeX 的括号或引号没有闭合。");
        }
        const start = index;
        while (index < source.length && !/[,}\n]/.test(source[index])) index++;
        return source.slice(start, index).trim();
    };
    while (index < source.length) {
        const start = source.indexOf("@", index);
        if (start < 0) break;
        index = start + 1;
        const match = /^[a-zA-Z]+\s*\{/.exec(source.slice(index));
        if (!match) throw new Error("BibTeX 条目格式无效。");
        const type = match[0].replace(/[\s{]/g, "").toLowerCase();
        index += match[0].length;
        if (["comment", "preamble", "string"].includes(type)) {
            let depth = 1;
            while (index < source.length && depth) { const char = source[index++]; if (char === "{") depth++; if (char === "}") depth--; }
            continue;
        }
        while (index < source.length && !/[,}]/.test(source[index])) index++;
        const fields: Record<string, string> = {};
        while (index < source.length) {
            skip();
            if (source[index] === "}") { index++; break; }
            const field = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*=/.exec(source.slice(index));
            if (!field) throw new Error("BibTeX 字段格式无效。");
            index += field[0].length;
            fields[field[1].toLowerCase()] = read().replace(/[{}]/g, "").replace(/\\([%&_#$])/g, "$1").trim();
        }
        if (!fields.title) throw new Error("BibTeX 中有条目缺少标题。");
        results.push({ title: fields.title, paper: { authors: (fields.author ?? "").replace(/\s+and\s+/g, "; "), doi: fields.doi ?? "", year: fields.year ?? "", venue: fields.journal ?? fields.booktitle ?? "", url: fields.url ? webURL(fields.url) : fields.doi ? `https://doi.org/${fields.doi}` : "", abstract: fields.abstract ?? "" } });
        if (results.length > 500) throw new Error("一次最多导入 500 条文献。");
    }
    if (!results.length) throw new Error("没有找到可导入的 BibTeX 条目。");
    return results;
}

export function bibTeX(pages: PageRecord[]): string {
    const escape = (value: string): string => value.replace(/\\/g, "\\textbackslash{}").replace(/[{}%&#_$]/g, "\\$&").replace(/\r?\n/g, " ");
    return pages.filter(page => page.kind === "paper").map(page => {
        const paper = page.paper ?? emptyPaper();
        const fields = { title: page.title, author: paper.authors.replace(/;\s*/g, " and "), year: paper.year, doi: paper.doi, journal: paper.venue, url: paper.url, abstract: paper.abstract };
        return `@article{labloom_${page.id.replaceAll("-", "")},\n${Object.entries(fields).filter(([, value]) => value).map(([key, value]) => `    ${key} = {${escape(value)}}`).join(",\n")}\n}`;
    }).join("\n\n");
}