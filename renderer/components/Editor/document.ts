import { Node as ExtensionNode, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Text } from "@tiptap/extension-text";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { type Node as DocNode, type Schema } from "@tiptap/pm/model";
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
    if (node.type.name === "pageTable") return "table";
    return node.type.name as ContentBlockKind;
}
export const isBlock = (n: DocNode): boolean => Object.hasOwn(n.attrs, "blockId");
const title = ExtensionNode.create({
    name: "pageTitle", content: "inline*", defining: true, addAttributes: blockAttrs,
    parseHTML: () => [{ tag: "h1[data-kind=title]" }], renderHTML: ({ node }) => ["h1", domAttrs(node), 0]
});
const body = ExtensionNode.create({
    name: "blockBody", content: "inline*", parseHTML: () => [{ tag: "p[data-body]" }],
    renderHTML: () => ["p", { "data-body": "" }, 0]
});
const block = ExtensionNode.create({
    name: "pageBlock", group: "workspaceBlock", content: "blockBody workspaceBlock*", defining: true,
    addAttributes: () => ({ ...blockAttrs(), kind: { default: "paragraph" } }), parseHTML: () => [{ tag: "section[data-kind]" }],
    renderHTML: ({ node }) => ["section", domAttrs(node), 0]
});
const cellParagraph = ExtensionNode.create({
    name: "paragraph", group: "block", content: "(text | hardBreak)*",
    parseHTML: () => [{ tag: "p" }], renderHTML: () => ["p", 0]
});
const table = ExtensionNode.create({
    name: "pageTable", group: "workspaceBlock", content: "table", defining: true, isolating: true,
    addAttributes: blockAttrs, renderHTML: ({ node }) => ["div", domAttrs(node), 0]
});
const inlineReference = ExtensionNode.create({
    name: "inlineReference", inline: true, group: "inline", atom: true,
    addAttributes: () => ({ target: { default: null }, label: { default: "引用" } }),
    parseHTML: () => [{ tag: "span[data-inline-target]", getAttrs: el => ({ target: { kind: el.dataset.targetKind, id: el.dataset.inlineTarget }, label: el.textContent?.replace(/^↗ /u, "") }) }],
    renderHTML: ({ node }) => ["span", { class: "inline-reference", "data-inline-target": node.attrs.target?.id, "data-target-kind": node.attrs.target?.kind }, "↗ " + node.attrs.label]
});
function atom(name: "hr" | "blocked_reference"): ExtensionNode {
    return ExtensionNode.create({
        name, group: "workspaceBlock", atom: true, selectable: true,
        addAttributes: () => ({ ...blockAttrs(), ...name === "blocked_reference" ? { target: { default: null } } : {} }),
        renderHTML: ({ node }) => ["div", domAttrs(node), name === "hr" ? ["hr"] : "链接引用"],
        addNodeView: () => ({ node }) => {
            const dom = document.createElement("div");
            dom.dataset.blockId = node.attrs.blockId;
            dom.dataset.kind = name;
            dom.contentEditable = "false";
            if (name === "hr") dom.append(document.createElement("hr"));
            else dom.textContent = "引用目标缺失";
            return { dom };
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
export const documentExtensions = [Document.extend({ content: "pageTitle workspaceBlock*" }), title, block, body, table,
Table.configure({ resizable: false }), TableRow, TableCell.extend({ content: "paragraph+" }), TableHeader.extend({ content: "paragraph+" }),
    cellParagraph, atom("hr"), referenceBlock, inlineReference, Text, HardBreak, bold, italic, underline, strike, code, fgColor, bgColor];
export const blankTable = (): RichNode => ({ type: "table", content: Array.from({ length: 2 }, () => ({ type: "tableRow", content: Array.from({ length: 2 }, () => ({ type: "tableCell", content: [{ type: "paragraph", content: [] }] })) })) });

export function blockJSON(b: ContentBlock, children: JSONContent[] = []): JSONContent {
    const attrs = { blockId: b.id, collapsed: b.payload.collapsed };
    if (b.type === "title") return { type: "pageTitle", attrs, content: b.payload.inline };
    if (b.type === "table") return { type: "pageTable", attrs, content: [b.payload.table ?? blankTable()] };
    if (b.type === "hr" || b.type === "blocked_reference") return { type: b.type, attrs: { ...attrs, target: b.payload.target } };
    return { type: "pageBlock", attrs: { ...attrs, kind: b.type }, content: [{ type: "blockBody", content: b.payload.inline }, ...children] };
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
    if (type === "table") value.table = tableData(node.firstChild!);
    else if (type === "blocked_reference") value.target = node.attrs.target;
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