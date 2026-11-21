import { Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { adjacent } from "./block-selection";
import { located, selectionIn } from "./transactions";
import type { Location } from "./document";

export function fold(tr: Transaction, { pos, node }: Location, collapsed = !node.attrs.collapsed): Transaction {
    if (node.type.name === "pageBlock" && node.childCount > 1 && !!node.attrs.collapsed !== collapsed)
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed });
    return tr;
}
export function reveal(tr: Transaction, pos: number): Transaction {
    const at = tr.doc.resolve(pos);
    for (let d = 1; d <= at.depth; d++) {
        const node = at.node(d);
        if (node.attrs.collapsed) fold(tr, { node, pos: at.before(d) }, false);
    }
    return tr;
}
export function skipFold(view: EditorView, event: KeyboardEvent): boolean {
    const { state } = view;
    if (!(state.selection instanceof TextSelection) || !state.selection.empty || event.shiftKey || event.ctrlKey || event.altKey) return false;
    const place = located(state);
    if (!place) return false;
    const dir = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const other = adjacent(state.doc, place.pos, dir, false);
    if (dir > 0 ? !place.node.attrs.collapsed : other === null || !state.doc.nodeAt(other)?.attrs.collapsed) return false;
    const edge = event.key === "ArrowDown" ? "down" : event.key === "ArrowUp" ? "up" : event.key === "ArrowLeft" ? "left" : "right";
    if (!view.endOfTextblock(edge)) return false;
    if (other !== null) {
        const node = state.doc.nodeAt(other)!;
        const at = other + (dir < 0 ? 2 + (node.firstChild?.content.size ?? 0) : 1);
        view.dispatch(selectionIn(state.tr, at).scrollIntoView());
    }
    return true;
}
// Protect native selection movement, including DOM selection changes from the browser.
export function visibleCaret(): Plugin {
    return new Plugin({ appendTransaction(transactions, _old, state) {
        const at = state.selection.$head;
        if (!(state.selection instanceof TextSelection) || !transactions.some(tr => tr.selectionSet || tr.docChanged)) return null;
        for (let d = 1; d < at.depth; d++) {
            const node = at.node(d);
            if (node.attrs.collapsed && at.index(d) > 0)
                return selectionIn(state.tr, at.before(d) + 2 + node.firstChild!.content.size);
        }
        return null;
    } });
}