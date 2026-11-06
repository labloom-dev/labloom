import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentNode, PageRecord } from "../../shared/types/knowledge";
import { identifier, markdown } from "./document";
import type { KnowledgeService } from "./service";
import type { PaperService } from "./papers";

export function exportPages(knowledge: KnowledgeService, papers: PaperService, workspace: string, parent: string, ids: string[]): string {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new Error("请选择 1 到 500 个页面。");
    const pages = new Map<string, PageRecord>();
    function collect(id: string): void {
        if (pages.has(id)) return;
        if (pages.size >= 500) throw new Error("关联页面超过 500 个，请缩小导出范围。");
        const page = knowledge.get(identifier(id)); pages.set(id, page);
        const visit = (node: DocumentNode): void => {
            if (node.type === "pageReference" && node.attrs?.targetId) collect(identifier(node.attrs.targetId));
            node.content?.forEach(visit);
        };
        if (!page.deleted) visit(page.document);
    }
    ids.forEach(collect);
    const directory = join(parent, `Labloom-export-${randomUUID().slice(0, 8)}`);
    const stage = `${directory}.partial`;
    mkdirSync(stage); mkdirSync(join(stage, "assets"));
    try {
        const assets = new Set<string>();
        for (const page of pages.values()) {
            const document = structuredClone(page.document);
            function images(node: DocumentNode): void {
                if (node.type === "image" && node.attrs) {
                    const match = /^data:image\/(png|jpeg|gif|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(String(node.attrs.src));
                    if (match) {
                        const data = Buffer.from(match[2], "base64");
                        const name = `${createHash("sha256").update(data).digest("hex")}.${match[1]}`;
                        if (!assets.has(name)) { writeFileSync(join(stage, "assets", name), data, { flag: "wx" }); assets.add(name); }
                        node.attrs.src = `assets/${name}`;
                    }
                }
                node.content?.forEach(images);
            }
            images(document);
            let body = `# ${page.title.replace(/[\r\n]/g, " ")}\n\n`;
            if (page.deleted) body += "此页面在回收站中，保留链接入口。\n\n";
            else {
                if (page.tags.length) body += `标签：${page.tags.join("、")}\n\n`;
                if (page.paper) body += `作者：${page.paper.authors}\n\n年份：${page.paper.year}\n\n来源：${page.paper.venue}\n\nDOI：${page.paper.doi}\n\n${page.paper.abstract}\n\n`;
                if (page.schedule) body += `计划：${page.schedule.start || "未设置开始"} / ${page.schedule.end || "未设置截止"}，${page.schedule.timezone}\n\n状态：${page.schedule.status}\n\n`;
                for (const block of document.content) body += `${block.attrs?.uid ? `<a id="${identifier(block.attrs.uid)}"></a>\n\n` : ""}${markdown(block)}`;
                if (page.kind === "paper") {
                    for (const attachment of papers.attachments(page.id)) {
                        const name = `${identifier(attachment.id)}.pdf`;
                        if (!assets.has(name)) { copyFileSync(join(workspace, "attachments", name), join(stage, "assets", name)); assets.add(name); }
                        body += `[${attachment.version} PDF 原文](assets/${name})\n\n`;
                    }
                }
            }
            writeFileSync(join(stage, `${page.id}.md`), body, { flag: "wx" });
        }
        writeFileSync(join(stage, "README.md"), `# Labloom 导出\n\n共 ${pages.size} 个页面，包含关联页面、图片和文献 PDF。文件名使用页面标识以保持链接稳定。\n\n${[...pages.values()].map(page => `- [${page.title.replace(/[\[\]\r\n]/g, " ")}](${page.id}.md)`).join("\n")}\n\nMarkdown 不保留文字颜色与实时同步。同步链接指向本次导出的目标页面快照。完整恢复请使用工作区备份。\n`, { flag: "wx" });
        renameSync(stage, directory);
        return directory;
    }
    catch (error) { rmSync(stage, { recursive: true, force: true }); throw error; }
}