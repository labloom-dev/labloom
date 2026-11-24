import zhCN from "../../../locales/zh-CN.json";
import { Node as ExtensionNode, type JSONContent, type NodeViewRenderer } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Text } from "@tiptap/extension-text";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { type Node as DocNode, type Schema } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { payload, references } from "../../../shared/content/blocks";
import { type ContentBlock, type ContentBlockKind, type InlineNode, type PageRecord, type RichNode } from "../../../shared/types/content";
import bold from "./extensions/mark/bold";
import italic from "./extensions/mark/italic";
import underline from "./extensions/mark/underline";
import strike from "./extensions/mark/strike";
import code from "./extensions/mark/code";
import fgColor from "./extensions/mark/fgColor";
import bgColor from "./extensions/mark/bgColor";
import { LabloomError } from "../../../shared/failure";

const blockAttrs = (): Record<string, { default: null; rendered: boolean }> => ({ blockId: { default: null, rendered: false }, collapsed: { default: null, rendered: false } });
const domAttrs = (node: DocNode): Record<string, string> => ({ "data-block-id": node.attrs.blockId, "data-kind": kindOf(node), ...(node.attrs.collapsed ? { "data-folded": "true" } : {}) });
export const canNest = (kind: string): boolean => ["paragraph", "ordered_list", "unordered_list", "blockquote", "callout"].includes(kind);
export function kindOf(node: DocNode): ContentBlockKind {
    if (node.type.name === "pageBlock") return node.attrs.kind;
    if (node.type.name === "pageTitle") return "title";
    if (node.type.name === "codeBlock") return "code";
    if (node.type.name === "pageTable") return "table";
    return node.type.name as ContentBlockKind;
}
export const isBlock = (n: DocNode): boolean => Object.hasOwn(n.attrs, "blockId");
const title = ExtensionNode.create({
    name: "pageTitle", content: "inline*", defining: true, addAttributes: blockAttrs,
    parseHTML: () => [{ tag: "h1[data-kind=title]" }], renderHTML: ({ node }) => ["h1", domAttrs(node), 0]
});
const bodyTags = { heading_1: "h1", heading_2: "h2", heading_3: "h3" } as const;
function bodyAttributes(kind: string): { heading: "h1" | "h2" | "h3" } | null {
    return Object.hasOwn(bodyTags, kind) ? { heading: bodyTags[kind as keyof typeof bodyTags] } : null;
}
const body = ExtensionNode.create({
    name: "blockBody", content: "inline*",
    addAttributes: () => ({ heading: { default: null, rendered: false } }),
    parseHTML: () => [{ tag: "[data-body]", getAttrs: element => bodyAttributes(element.parentElement?.dataset.kind ?? "") }],
    renderHTML: ({ node }) => {
        const { heading } = node.attrs;
        return [heading === "h1" || heading === "h2" || heading === "h3" ? heading : "div", { "data-body": "" }, 0];
    }
});
const block = ExtensionNode.create({
    name: "pageBlock", group: "workspaceBlock", content: "blockBody workspaceBlock*", defining: true,
    addAttributes: () => ({ ...blockAttrs(), kind: { default: "paragraph" } }),
    parseHTML: () => ["div[data-kind]:has(> [data-body])", "section[data-kind]"].map(tag => ({
        tag, getAttrs: element => ({ kind: element.dataset.kind, collapsed: element.hasAttribute("data-folded") })
    })),
    renderHTML: ({ node }) => ["div", domAttrs(node), 0],
    addProseMirrorPlugins() {
        const blockType = this.type;
        return [new Plugin({
            appendTransaction(_transactions, previous, next) {
                if (previous.doc === next.doc) return null;
                const start = previous.doc.content.findDiffStart(next.doc.content);
                if (start === null) return null;
                const end = previous.doc.content.findDiffEnd(next.doc.content)?.b ?? next.doc.content.size;
                const tr = next.tr;
                // A conversion can reuse the old body. Normalize changed blocks without replacing their content.
                next.doc.nodesBetween(Math.min(start, end), Math.max(start, end), (node, pos) => {
                    if (node.type !== blockType) return false;
                    const heading = bodyAttributes(node.attrs.kind)?.heading ?? null;
                    if (node.firstChild!.attrs.heading !== heading) tr.setNodeAttribute(pos + 1, "heading", heading);
                    return true;
                });
                return tr.docChanged ? tr : null;
            }
        })];
    }
});
const codeLine = ExtensionNode.create({
    name: "codeLine", content: "(text | inlineReference)*", code: true, whitespace: "pre",
    parseHTML: () => [{ tag: "[data-code-line]", preserveWhitespace: "full" }],
    renderHTML: () => ["div", { "data-code-line": "" }, 0]
});
export function codeLines(inline: InlineNode[]): JSONContent[] {
    const lines: JSONContent[] = [{ type: "codeLine", content: [] }];
    for (const node of inline) {
        if (node.type === "hardBreak") lines.push({ type: "codeLine", content: [] });
        else if (node.type === "text") {
            const parts = node.text.split(/\r\n?|\n/u);
            for (const [index, text] of parts.entries()) {
                if (index) lines.push({ type: "codeLine", content: [] });
                if (text) lines[lines.length - 1].content!.push({ ...node, text });
            }
        }
        else lines[lines.length - 1].content!.push(node);
    }
    return lines;
}
function codeInline(node: DocNode): InlineNode[] {
    const result: InlineNode[] = [];
    function append(item: InlineNode): void {
        const last = result.at(-1);
        if (item.type === "text" && last?.type === "text" && ((!last.marks && !item.marks) || JSON.stringify(last.marks) === JSON.stringify(item.marks))) last.text += item.text;
        else result.push(item);
    }
    node.forEach((line, _offset, index) => {
        if (index) append({ type: "text", text: "\n" });
        line.forEach(child => append(child.toJSON() as InlineNode));
    });
    return result;
}
export const codeBlock = ExtensionNode.create<{ nodeView: NodeViewRenderer | null }>({
    name: "codeBlock", group: "workspaceBlock", content: "codeLine+", defining: true, code: true,
    addOptions: () => ({ nodeView: null }),
    addAttributes: () => ({ ...blockAttrs(), language: { default: null, rendered: false } }),
    parseHTML: () => [{ tag: "[data-kind=code]", priority: 60, preserveWhitespace: "full", getAttrs: el => ({ language: el.dataset.language || null }) }],
    renderHTML: ({ node }) => ["div", { ...domAttrs(node), ...(node.attrs.language ? { "data-language": node.attrs.language } : {}) }, 0],
    addNodeView() {
        return this.options.nodeView;
    }
});
const cellParagraph = ExtensionNode.create({
    name: "paragraph", group: "block", content: "(text | hardBreak)*",
    parseHTML: () => [{ tag: "[data-cell-line]" }, { tag: "p" }], renderHTML: () => ["div", { "data-cell-line": "" }, 0]
});
const table = ExtensionNode.create({
    name: "pageTable", group: "workspaceBlock", content: "table", defining: true, isolating: true,
    addAttributes: blockAttrs, renderHTML: ({ node }) => ["div", domAttrs(node), 0]
});
export const inlineReference = ExtensionNode.create<{ nodeView: NodeViewRenderer | null; label: () => string }>({
    addOptions: () => ({ nodeView: null, label: () => zhCN.block.blocked_reference }),
    addNodeView() {
        return this.options.nodeView;
    },
    name: "inlineReference", inline: true, group: "inline", atom: true,
    addAttributes: () => ({ target: { default: null }, label: { default: "" } }),
    parseHTML: () => [{ tag: "span[data-inline-target]", getAttrs: el => ({ target: { kind: el.dataset.targetKind, id: el.dataset.inlineTarget }, label: el.textContent?.replace(/^↗ /u, "") }) }],
    renderHTML({ node }) {
        return ["span", { class: "inline-reference", "data-inline-target": node.attrs.target?.id, "data-target-kind": node.attrs.target?.kind }, "↗ " + (node.attrs.label || this.options.label())];
    }
});
function atom(name: "hr" | "blocked_reference"): ExtensionNode<{ nodeView: NodeViewRenderer | null; label: () => string }> {
    return ExtensionNode.create<{ nodeView: NodeViewRenderer | null; label: () => string }>({
        name, group: "workspaceBlock", atom: true, selectable: true,
        addOptions: () => ({ nodeView: null, label: () => zhCN.block.blocked_reference }),
        addAttributes: () => ({ ...blockAttrs(), ...name === "blocked_reference" ? { target: { default: null } } : {} }),
        renderHTML({ node }) {
            return ["div", domAttrs(node), name === "hr" ? ["hr"] : this.options.label()];
        },
        addNodeView() {
            if (this.options.nodeView) return this.options.nodeView;
            return ({ node }) => {
                const dom = document.createElement("div");
                dom.dataset.blockId = node.attrs.blockId;
                dom.dataset.kind = name;
                dom.contentEditable = "false";
                if (name === "hr") dom.append(document.createElement("hr"));
                else dom.textContent = zhCN.editor.missingReference;
                return { dom };
            };
        }
    });
}
const HardBreak = ExtensionNode.create({
    name: "hardBreak", inline: true, group: "inline", selectable: false,
    parseHTML: () => [{ tag: "br" }], renderHTML: () => ["br"],
    addKeyboardShortcuts() {
        return { "Shift-Enter": () => this.editor.commands.insertContent({ type: "hardBreak" }) };
    }
});
export const referenceBlock = atom("blocked_reference");
export const documentExtensions = [Document.extend({ content: "pageTitle workspaceBlock*" }), title, block, body, codeLine, codeBlock, table,
Table.configure({ resizable: false }), TableRow, TableCell.extend({ content: "paragraph+" }), TableHeader.extend({ content: "paragraph+" }),
    cellParagraph, atom("hr"), referenceBlock, inlineReference, Text, HardBreak, bold, italic, underline, strike, code, fgColor, bgColor];
export const blankTable = (): RichNode => ({ type: "table", content: Array.from({ length: 2 }, () => ({ type: "tableRow", content: Array.from({ length: 2 }, () => ({ type: "tableCell", content: [{ type: "paragraph", content: [] }] })) })) });

export function blockJSON(b: ContentBlock, children: JSONContent[] = []): JSONContent {
    const attrs = { blockId: b.id, collapsed: b.payload.collapsed };
    if (b.type === "code") return { type: "codeBlock", attrs: { ...attrs, language: b.payload.language }, content: codeLines(b.payload.inline) };
    if (b.type === "title") return { type: "pageTitle", attrs, content: b.payload.inline };
    if (b.type === "table") return { type: "pageTable", attrs, content: [b.payload.table ?? blankTable()] };
    if (b.type === "hr" || b.type === "blocked_reference") return { type: b.type, attrs: { ...attrs, target: b.payload.target } };
    const body = { type: "blockBody", attrs: bodyAttributes(b.type) ?? undefined, content: b.payload.inline };
    return { type: "pageBlock", attrs: { ...attrs, kind: b.type }, content: [body, ...children] };
}
export function subtree(id: string, blocks: PageRecord["blocks"]): JSONContent {
    const b = blocks[id];
    if (!b) throw new LabloomError({ kind: "block-missing", blockId: id });
    return blockJSON(b, b.children.map(child => subtree(child, blocks)));
}
export function pageDocument(page: PageRecord): JSONContent {
    return { type: "doc", content: [subtree(page.titleBlockId, page.blocks), ...page.children.map(id => subtree(id, page.blocks))] };
}
export function childIds(node: DocNode): string[] {
    const ids: string[] = [];
    node.forEach(child => {
        if (isBlock(child) && child.type.name !== "pageTitle") ids.push(child.attrs.blockId);
    });
    return ids;
}
function tableData(node: DocNode): RichNode {
    const json = node.toJSON() as RichNode;
    function clean(value: RichNode): void {
        if (value.type === "paragraph") value.content ??= [];
        if (value.attrs) {
            const a = value.attrs = { ...value.attrs };
            if (a.colspan === 1) delete a.colspan;
            if (a.rowspan === 1) delete a.rowspan;
            if (a.colwidth === null) delete a.colwidth;
            if (a.align === null) delete a.align;
            if (!Object.keys(a).length) delete value.attrs;
        }
        value.content?.forEach(clean);
    }
    clean(json);
    return json;
}
export function blockData(node: DocNode): ContentBlock {
    const type = kindOf(node), value = payload(type);
    if (node.attrs.collapsed != null) value.collapsed = node.attrs.collapsed;
    if (type === "code" && node.attrs.language) value.language = node.attrs.language;
    if (type === "table") value.table = tableData(node.firstChild!);
    else if (type === "blocked_reference") value.target = node.attrs.target;
    else if (node.type.name === "codeBlock") value.inline = codeInline(node);
    else if (node.type.name === "pageBlock" || type === "title") value.inline = ((type === "title" ? node : node.firstChild!).content.toJSON() ?? []) as InlineNode[];
    return { id: node.attrs.blockId, type, payload: value, children: childIds(node) };
}
export type Location = { node: DocNode; pos: number };
export type BlockIndex = Map<string, Location[]>;
const indices = new WeakMap<DocNode, BlockIndex>();
export function indexDoc(doc: DocNode): BlockIndex {
    let index = indices.get(doc);
    if (index) return index;
    index = new Map();
    doc.descendants((node, pos) => {
        if (!isBlock(node)) return false;
        const found = index!.get(node.attrs.blockId);
        if (found) found.push({ pos, node });
        else index!.set(node.attrs.blockId, [{ pos, node }]);
        return node.type.name === "pageBlock";
    });
    indices.set(doc, index);
    return index;
}
export type DocumentEdit = { blocks: ContentBlock[]; pageChildren?: string[] };
export function documentEdit(before: DocNode, after: DocNode): DocumentEdit {
    const old = indexDoc(before), next = indexDoc(after);
    const blocks: ContentBlock[] = [];
    for (const [id, locations] of next) {
        const previous = old.get(id)?.[0]?.node, node = locations[0].node;
        if (previous === node) continue;
        const value = blockData(node);
        if (!previous || JSON.stringify(blockData(previous)) !== JSON.stringify(value)) blocks.push(value);
    }
    const children = childIds(after), prior = childIds(before);
    return { blocks, ...(children.length !== prior.length || children.some((id, i) => id !== prior[i]) ? { pageChildren: children } : {}) };
}
export function removesReference(edit: DocumentEdit, page: PageRecord): boolean {
    const seen = new Set<string>();
    function contains(id: string): boolean {
        if (seen.has(id)) return false;
        seen.add(id);
        const b = page.blocks[id];
        return !!b && (!!references(b).length || b.children.some(contains));
    }
    function removed(prior: string[], next: string[]): boolean {
        const counts = new Map<string, number>();
        for (const id of next) counts.set(id, (counts.get(id) ?? 0) + 1);
        return prior.some(id => {
            const n = counts.get(id) ?? 0;
            if (n) counts.set(id, n - 1);
            return !n && contains(id);
        });
    }
    if (edit.pageChildren && removed(page.children, edit.pageChildren)) return true;
    return edit.blocks.some(b => {
        const base = page.blocks[b.id];
        if (!base) return false;
        const targets = new Set(references(b).map(t => t.kind + t.id));
        return references(base).some(t => !targets.has(t.kind + t.id)) || removed(base.children, b.children);
    });
}
export function blankBlock(schema: Schema, type: ContentBlockKind = "paragraph", text = ""): DocNode {
    const value = { id: "", type, payload: payload(type, text), children: [] };
    const json = blockJSON(value);
    json.attrs!.blockId = null;
    return schema.nodeFromJSON(json);
}