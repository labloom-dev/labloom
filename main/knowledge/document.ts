import type { DocumentNode, RichDocument } from "../../shared/types/knowledge";

import { documentText } from "../../shared/utils/document";
export { documentText };

const nodeTypes = new Set(["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak", "image", "table", "tableRow", "tableCell", "tableHeader", "pageReference"]);
const markTypes = new Set(["bold", "italic", "underline", "strike", "code", "fgColor", "bgColor", "link"]);

export function object(value: unknown, message = "无效的参数。"): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
    return value as Record<string, unknown>;
}

export function text(value: unknown, max = 1000, empty = true): string {
    if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new Error("文本为空或超过长度限制。");
    return value;
}

export function identifier(value: unknown): string {
    const id = text(value, 100, false);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(id)) throw new Error("无效的内容标识。");
    return id;
}

export function webURL(value: unknown, empty = false): string {
    const raw = text(value, 4096);
    if (empty && !raw) return "";
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("只支持 HTTP 或 HTTPS 地址。");
    return url.href;
}

export function validateDocument(value: unknown): RichDocument {
    const root = object(value, "无效的文档。");
    if (root.type !== "doc" || !Array.isArray(root.content)) throw new Error("无效的文档结构。");
    if (JSON.stringify(root).length > 8 * 1024 * 1024) throw new Error("单页内容不能超过 8 MB。");
    let count = 0;
    function visit(value: unknown, depth: number): DocumentNode {
        const node = object(value);
        if (++count > 20000 || depth > 32 || typeof node.type !== "string" || !nodeTypes.has(node.type)) throw new Error("文档包含不支持的块，或嵌套层级过深。");
        const result: DocumentNode = { type: node.type };
        if (node.text !== undefined) result.text = text(node.text, 1000000);
        if (node.attrs !== undefined) {
            const attrs = object(node.attrs);
            result.attrs = JSON.parse(JSON.stringify(attrs));
            if (node.type === "image" && !/^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(String(attrs.src))) throw new Error("图片必须通过本地图片入口导入。");
            if (node.type === "pageReference") {
                identifier(attrs.targetId);
                if (attrs.blockId) identifier(attrs.blockId);
                if (!["reference", "sync"].includes(String(attrs.mode))) throw new Error("无效的链接类型。");
                if (attrs.writable !== undefined && typeof attrs.writable !== "boolean") throw new Error("无效的同步权限。");
            }
        }
        if (node.marks !== undefined) {
            if (!Array.isArray(node.marks) || node.marks.length > 10) throw new Error("无效的文字格式。");
            result.marks = node.marks.map(value => {
                const mark = object(value);
                if (typeof mark.type !== "string" || !markTypes.has(mark.type)) throw new Error("不支持的文字格式。");
                const attrs = mark.attrs ? object(mark.attrs) : undefined;
                if (mark.type === "link") webURL(attrs?.href);
                return { type: mark.type, ...(attrs ? { attrs } : {}) };
            });
        }
        if (node.content !== undefined) {
            if (!Array.isArray(node.content)) throw new Error("无效的内容块。");
            result.content = node.content.map(child => visit(child, depth + 1));
        }
        return result;
    }
    return visit(root, 0) as RichDocument;
}

export function plainDocument(value: string): RichDocument {
    return { type: "doc", content: value.split(/\r?\n/).map(line => ({ type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] } : {}) })) };
}

function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}[\]<>]/g, "\\$&");
}

export function markdown(node: DocumentNode): string {
    let value = (node.content ?? []).map(markdown).join("");
    switch (node.type) {
        case "text": {
            value = escapeMarkdown(node.text ?? "");
            for (const mark of node.marks ?? []) {
                if (mark.type === "bold") value = `**${value}**`;
                if (mark.type === "italic") value = `*${value}*`;
                if (mark.type === "strike") value = `~~${value}~~`;
                if (mark.type === "code") value = `\`${value.replaceAll("`", "\\`")}\``;
                if (mark.type === "link") value = `[${value}](${String(mark.attrs?.href).replaceAll(")", "%29")})`;
            }
            return value;
        }
        case "paragraph": return `${value}\n\n`;
        case "heading": return `${"#".repeat(Math.max(1, Math.min(6, Number(node.attrs?.level) || 1)))} ${value}\n\n`;
        case "blockquote": return value.trim().split("\n").map(line => `> ${line}`).join("\n") + "\n\n";
        case "bulletList": return (node.content ?? []).map(item => `- ${markdown(item).trim().replaceAll("\n", "\n  ")}\n`).join("") + "\n";
        case "orderedList": return (node.content ?? []).map((item, index) => `${index + 1}. ${markdown(item).trim().replaceAll("\n", "\n   ")}\n`).join("") + "\n";
        case "codeBlock": return `\n\`\`\`\`\`\`\n${documentText(node)}\n\`\`\`\`\`\`\n\n`;
        case "horizontalRule": return "---\n\n";
        case "hardBreak": return "  \n";
        case "image": return `![${escapeMarkdown(String(node.attrs?.alt ?? "图片"))}](${String(node.attrs?.src)})\n\n`;
        case "pageReference": return `[${escapeMarkdown(String(node.attrs?.title ?? "页面链接"))}](${node.attrs?.targetId}.md${node.attrs?.blockId ? `#${node.attrs.blockId}` : ""})\n\n`;
        case "table": return (node.content ?? []).map((row, index) => {
            const cells = row.content ?? [];
            const line = `| ${cells.map(cell => documentText(cell).replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |\n`;
            return line + (index === 0 ? `| ${cells.map(() => "---").join(" | ")} |\n` : "");
        }).join("") + "\n";
        default: return value;
    }
}