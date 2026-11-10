import { Extension } from "@tiptap/core";
import { Fragment, Slice, type Node as DocNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, TextSelection, type Command, type EditorState, type Transaction } from "@tiptap/pm/state";
import { blankBlock, canNest, indexDoc, isBlock, kindOf, type Location } from "./document";

export const remoteEdit = "workspace.reread", syncInsert = "workspace.sync", splitBlock = "workspace.split";
export function located(state: Pick<EditorState, "doc" | "selection">, pos = state.selection.from): Location | null {
    const resolved = state.doc.resolve(pos);
    for (let d = resolved.depth; d > 0; d--) if (isBlock(resolved.node(d))) return { node: resolved.node(d), pos: resolved.before(d) };
    return isBlock(resolved.nodeAfter ?? state.doc) ? { node: resolved.nodeAfter!, pos } : null;
}
export function selectionIn(tr: Transaction, pos: number): Transaction {
    return tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, Math.min(pos, tr.doc.content.size))), 1));
}
export const split: Command = (state, dispatch) => {
    const tr = state.tr.deleteSelection(), at = tr.selection.$from;
    const loc = located(tr);
    if (!loc || !["pageBlock", "pageTitle"].includes(loc.node.type.name) || !at.parent.inlineContent) return false;
    if (!dispatch) return true;
    const { node, pos } = loc, title = node.type.name === "pageTitle", field = title ? node : node.firstChild!;
    const offset = at.parentOffset, left = field.copy(field.content.cut(0, offset)), right = field.content.cut(offset);
    const first = title ? left : node.copy(node.content.replaceChild(0, left));
    const next = blankBlock(state.schema, !title && node.attrs.kind.includes("list") ? node.attrs.kind : "paragraph");
    const sibling = next.copy(Fragment.from(next.firstChild!.copy(right)));
    tr.replaceWith(pos, pos + node.nodeSize, [first, sibling]).setMeta(splitBlock, { id: node.attrs.blockId, pos });
    dispatch(selectionIn(tr, pos + first.nodeSize + 2).scrollIntoView());
    return true;
};
export const backspace: Command = (state, dispatch) => {
    if (!state.selection.empty || state.selection.$from.parentOffset) return false;
    const loc = located(state);
    if (!loc || loc.node.type.name !== "pageBlock") return false;
    const { node, pos } = loc, at = state.doc.resolve(pos), previous = at.nodeBefore;
    if (!node.firstChild!.content.size) {
        if (dispatch) dispatch(selectionIn(state.tr.delete(pos, pos + node.nodeSize), Math.max(1, pos - 2)).scrollIntoView());
        return true;
    }
    if (!previous || !["pageBlock", "pageTitle"].includes(previous.type.name)) return false;
    if (dispatch) {
        const field = previous.type.name === "pageTitle" ? previous : previous.firstChild!;
        const joined = field.copy(field.content.append(node.firstChild!.content));
        const kids = node.content.cut(node.firstChild!.nodeSize);
        let first = previous.type.name === "pageTitle" ? joined : previous.copy(previous.content.replaceChild(0, joined));
        const canContain = canNest(kindOf(first));
        if (canContain) first = first.copy(first.content.append(kids));
        const start = pos - previous.nodeSize;
        const tr = state.tr.replaceWith(start, pos + node.nodeSize, canContain ? Fragment.from(first) : Fragment.from(first).append(kids));
        dispatch(selectionIn(tr, start + (previous.type.name === "pageTitle" ? 1 : 2) + field.content.size).scrollIntoView());
    }
    return true;
};
export function indent(out: boolean): Command {
    return (state, dispatch) => {
        const loc = located(state);
        if (!loc || loc.node.type.name === "pageTitle" || loc.node.type.name === "pageTable") return false;
        const { pos, node } = loc, at = state.doc.resolve(pos);
        const previous = at.nodeBefore;
        if (out ? at.depth < 1 : !previous || !canNest(kindOf(previous)) || previous.attrs.blockId === node.attrs.blockId) return true;
        if (!dispatch) return true;
        const offset = state.selection.head - pos, tr = state.tr.delete(pos, pos + node.nodeSize);
        const dest = out ? tr.mapping.map(at.after()) : pos - 1;
        tr.insert(dest, node).setMeta("workspace.move", true);
        dispatch(selectionIn(tr, dest + offset).scrollIntoView());
        return true;
    };
}

export function shallowPaste(slice: Slice): Slice {
    const copy = (node: DocNode): DocNode => {
        if (isBlock(node)) return node.type.create({ ...node.attrs, blockId: null }, node.content, node.marks);
        return node;
    };
    return new Slice(Fragment.fromArray(slice.content.content.map(copy)), slice.openStart, slice.openEnd);
}
export function clipboardRows(state: EditorState, rows: { text: string; kind: "paragraph" | "ordered_list" | "unordered_list" }[]): Transaction {
    const tr = state.tr.deleteSelection(), loc = located(tr), at = tr.selection.$from;
    if (!loc || !at.parent.inlineContent || loc.node.type.name === "pageTable") return tr.insertText(rows.map(r => r.text).join("\n"));
    const { pos, node } = loc, field = at.parent, title = node.type.name === "pageTitle";
    const left = field.content.cut(0, at.parentOffset), right = field.content.cut(at.parentOffset);
    const nodes: DocNode[] = rows.map(r => blankBlock(state.schema, r.kind, r.text));
    const last = nodes[nodes.length - 1], endText = last.firstChild!.content.size;
    nodes[nodes.length - 1] = last.copy(Fragment.from(last.firstChild!.copy(last.firstChild!.content.append(right))));
    if (title || left.size || node.childCount > 1) {
        const before = field.copy(left);
        nodes.unshift(title ? before : node.copy(node.content.replaceChild(0, before)));
    }
    tr.replaceWith(pos, pos + node.nodeSize, nodes);
    const end = pos + nodes.slice(0, -1).reduce((n, b) => n + b.nodeSize, 0) + 2 + endText;
    return selectionIn(tr, end).scrollIntoView();
}

export function identityPlugin(): Plugin {
    return new Plugin({
        appendTransaction(transactions, old, next) {
            if (!transactions.some(tr => tr.docChanged) || transactions.some(tr => tr.getMeta(remoteEdit))) return null;
            const tr = next.tr, prior = indexDoc(old.doc), current = indexDoc(next.doc);
            // Paste clears copied roots before fitting the slice. A native split may copy the left node's ID.
            for (const [id, occurrences] of current) {
                const surplus = occurrences.length - (prior.get(id)?.length ?? 0);
                if (id && (surplus <= 0 || transactions.some(t => t.getMeta(syncInsert) || t.getMeta("workspace.paste")))) continue;
                if (!id && occurrences.some(o => o.node.type.name === "pageTitle")) {
                    for (const o of occurrences.filter(o => o.node.type.name === "pageTitle")) tr.setNodeMarkup(o.pos, undefined, { ...o.node.attrs, blockId: old.doc.firstChild!.attrs.blockId });
                }
                const retained = new Set((prior.get(id) ?? []).map(place => transactions.reduce((pos, t) => t.mapping.map(pos, 1), place.pos)));
                const fresh = id && prior.has(id) ? occurrences.filter(o => !retained.has(o.pos)).slice(-surplus) : occurrences;
                for (const { pos, node } of fresh) if (node.type.name !== "pageTitle") tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: crypto.randomUUID() });
            }
            const corrected = indexDoc(tr.doc), split = transactions.find(t => t.getMeta(splitBlock))?.getMeta(splitBlock);
            const edits: { pos: number; end: number; content: DocNode | DocNode[] }[] = [];
            for (const [id, places] of corrected) {
                if (places.length < 2) continue;
                const originals = prior.get(id);
                if (!originals) continue;
                const oldNodes = new Set(originals.map(p => p.node));
                const edited = places.find(p => !oldNodes.has(p.node));
                if (!edited) continue;
                const right = split?.id === id ? tr.doc.nodeAt(split.pos + edited.node.nodeSize) : null;
                for (const place of places) {
                    if (place === edited) continue;
                    if (right || !place.node.eq(edited.node)) edits.push({ pos: place.pos, end: place.pos + place.node.nodeSize, content: right ? [edited.node, right] : edited.node });
                }
            }
            const start = tr.steps.length;
            for (const edit of edits.sort((a, b) => b.pos - a.pos)) {
                const mapping = tr.mapping.slice(start);
                tr.replaceWith(mapping.map(edit.pos, 1), mapping.map(edit.end, -1), edit.content);
            }
            return tr.docChanged ? tr : null;
        }
    });
}
export const editing = Extension.create({
    name: "workspaceEditing", priority: 1200,
    addProseMirrorPlugins: () => [identityPlugin()],
    addKeyboardShortcuts() {
        const command = (cmd: Command): boolean => cmd(this.editor.state, this.editor.view.dispatch);
        return {
            Escape: () => {
                const { state, view } = this.editor, place = located(state);
                if (!place || !state.selection.empty || place.node.type.name === "pageTitle") return false;
                view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, place.pos)));
                return true;
            },
            Enter: () => !this.editor.view.composing && command(split),
            Backspace: () => !this.editor.view.composing && command(backspace),
            Tab: () => command(indent(false)),
            "Shift-Tab": () => command(indent(true))
        };
    }
});