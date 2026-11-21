import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { blankBlock, kindOf } from "./document";
import { located, selectionIn } from "./transactions";

export function pasteCode(view: EditorView, text: string): void {
    const { schema, tr } = view.state;
    const lines = text.split(/\r\n?|\n/u).map(line => schema.nodes.codeLine.create(null, line ? schema.text(line) : undefined));
    view.dispatch(tr.replaceSelection(new Slice(Fragment.fromArray(lines), 1, 1)).setStoredMarks([]).scrollIntoView());
}
export function codeKeys(view: EditorView, event: KeyboardEvent): boolean {
    const { state } = view, loc = located(state);
    if (!loc || kindOf(loc.node) !== "code") return false;
    const { $from, $to } = state.selection, depth = $from.depth - 1;
    if ($from.parent.type.name !== "codeLine" || $to.parent.type.name !== "codeLine" || $to.node(depth) !== loc.node) return false;
    if (event.ctrlKey && event.altKey && event.code === "KeyL") {
        (view.nodeDOM(loc.pos) as HTMLElement)?.querySelector<HTMLButtonElement>(".code-language")?.click();
        return true;
    }
    if (!view.editable) return false;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ["b", "i", "u", "e", "s", "r"].includes(event.key.toLowerCase())) return true;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const tr = state.tr;
    if (event.key === "Enter") {
        tr.deleteSelection(); tr.split(tr.selection.from);
    }
    else if (event.key === "Tab") {
        if (!event.shiftKey && state.selection.empty) tr.replaceSelectionWith(state.schema.text("    "), false);
        else {
            const first = $from.index(depth), last = $to.index(depth) - ($from.index(depth) !== $to.index(depth) && $to.parentOffset === 0 ? 1 : 0);
            let start = $from.start();
            for (let i = first; i <= last; i++) {
                const line = loc.node.child(i), pos = tr.mapping.map(start);
                if (event.shiftKey) {
                    const length = /^(?:\t| {1,4})/u.exec(line.textContent)?.[0].length ?? 0;
                    if (length) tr.delete(pos, pos + length);
                }
                else tr.insertText("    ", pos);
                start += line.nodeSize;
            }
            tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(state.selection.anchor), tr.mapping.map(state.selection.head)));
        }
    }
    else if (event.key === "ArrowDown" && !event.shiftKey && state.selection.empty && $from.index(depth) === loc.node.childCount - 1) {
        const end = loc.pos + loc.node.nodeSize;
        if (!TextSelection.findFrom(state.doc.resolve(end), 1)) tr.insert(end, blankBlock(state.schema));
        selectionIn(tr, end + 1);
    }
    else return false;
    view.dispatch(tr.scrollIntoView());
    return true;
}