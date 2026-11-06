import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { tableEditing, goToNextCell } from "@tiptap/pm/tables";
import { Plugin } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { mount, unmount } from "svelte";
import ReferenceView from "../../Knowledge/ReferenceView.svelte";

export const BlockIdentity = Extension.create({
    name: "blockIdentity",
    addGlobalAttributes: () => [{
        types: ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", "image", "table", "pageReference"],
        attributes: { uid: { default: null, parseHTML: element => element.getAttribute("data-block-id"), renderHTML: attributes => attributes.uid ? { "data-block-id": attributes.uid } : {} } }
    }],
    addProseMirrorPlugins: () => [new Plugin({
        appendTransaction(transactions, _previous, state) {
            if (!transactions.some(transaction => transaction.docChanged)) return null;
            const ids = new Set<string>();
            const transaction = state.tr;
            state.doc.forEach((node, position) => {
                if (!("uid" in node.attrs)) return;
                const id = node.attrs.uid;
                if (!id || ids.has(id)) transaction.setNodeMarkup(position, undefined, { ...node.attrs, uid: crypto.randomUUID() });
                else ids.add(id);
            });
            return transaction.docChanged ? transaction.setMeta("addToHistory", false) : null;
        },
        props: {
            transformPasted(slice) {
                const copy = (node: ProseMirrorNode): ProseMirrorNode => node.isText ? node : node.type.create({ ...node.attrs, ...("uid" in node.attrs ? { uid: null } : {}) }, Fragment.fromArray(Array.from({ length: node.childCount }, (_, index) => copy(node.child(index)))), node.marks);
                return new Slice(Fragment.fromArray(Array.from({ length: slice.content.childCount }, (_, index) => copy(slice.content.child(index)))), slice.openStart, slice.openEnd);
            }
        }
    })]
});

export const LocalImage = Node.create({
    name: "image", group: "block", atom: true, draggable: true,
    addAttributes: () => ({ src: { default: "" }, alt: { default: "" } }),
    parseHTML: () => [{ tag: "img[src^='data:image/']" }],
    renderHTML: ({ HTMLAttributes }) => ["img", mergeAttributes(HTMLAttributes, { class: "document-image" })]
});
export const Table = Node.create({ name: "table", group: "block", content: "tableRow+", isolating: true, parseHTML: () => [{ tag: "table" }], renderHTML: ({ HTMLAttributes }) => ["table", HTMLAttributes, ["tbody", 0]] });
export const TableRow = Node.create({ name: "tableRow", content: "(tableCell | tableHeader)+", parseHTML: () => [{ tag: "tr" }], renderHTML: () => ["tr", 0] });
const cellAttributes = () => ({ colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } });
export const TableCell = Node.create({ name: "tableCell", addAttributes: cellAttributes, content: "block+", isolating: true, parseHTML: () => [{ tag: "td" }], renderHTML: () => ["td", 0] });
export const TableHeader = Node.create({ name: "tableHeader", addAttributes: cellAttributes, content: "block+", isolating: true, parseHTML: () => [{ tag: "th" }], renderHTML: () => ["th", 0] });

export const TableEditing = Extension.create({
    name: "tableEditing",
    extendNodeSchema(extension) { return { tableRole: ({ table: "table", tableRow: "row", tableCell: "cell", tableHeader: "header_cell" } as Record<string, string>)[extension.name] }; },
    addProseMirrorPlugins: () => [tableEditing()],
    addKeyboardShortcuts() {
        return {
            Tab: () => this.editor.commands.command(({ state, dispatch }) => goToNextCell(1)(state, dispatch)),
            "Shift-Tab": () => this.editor.commands.command(({ state, dispatch }) => goToNextCell(-1)(state, dispatch))
        };
    }
});

export function pageReference(ancestors: string[]): Node {
    return Node.create({
        name: "pageReference", group: "block", atom: true, draggable: true,
        addAttributes: () => ({ targetId: { default: "" }, blockId: { default: null }, linkId: { default: null }, mode: { default: "reference" }, writable: { default: false }, title: { default: "页面链接" } }),
        parseHTML: () => [{ tag: "div[data-page-reference]" }],
        renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-page-reference": "" }), String(HTMLAttributes.title)],
        addNodeView: () => ({ node, getPos, editor }) => {
            const dom = document.createElement("div");
            dom.contentEditable = "false";
            dom.className = "page-reference-node";
            const props = $state({ targetId: String(node.attrs.targetId), blockId: node.attrs.blockId as string | null, mode: node.attrs.mode as "reference" | "sync", writable: !!node.attrs.writable, ancestors });
            const component = mount(ReferenceView, { target: dom, props: { config: props, onunlink: document => {
                const position = getPos();
                if (position === undefined) return;
                editor.chain().focus().insertContentAt({ from: position, to: position + node.nodeSize }, document.content).run();
            } } });
            return {
                dom,
                update(updated) {
                    if (updated.type !== node.type) return false;
                    node = updated;
                    Object.assign(props, { targetId: String(node.attrs.targetId), blockId: node.attrs.blockId, mode: node.attrs.mode, writable: !!node.attrs.writable });
                    return true;
                },
                stopEvent: event => !!(event.target as HTMLElement)?.closest("button, input, select, textarea, .tiptap"),
                ignoreMutation: () => true,
                destroy: () => { void unmount(component); }
            };
        }
    });
}