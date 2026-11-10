import type { Editor } from "@tiptap/core";
import { deleteSelection, joinBackward, joinForward, selectNodeBackward, selectNodeForward, splitBlock } from "@tiptap/pm/commands";
import type { Command } from "@tiptap/pm/state";
import { backspace, indent, split } from "./transactions";

type Input = { text: string } | { key: "Enter" | "Backspace" | "Delete" | "Tab"; shift: boolean };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function erase(editor: Editor, backward: boolean): void {
    const { state, view } = editor;
    if (deleteSelection(state, view.dispatch) || (backward && backspace(state, view.dispatch))) return;
    const at = state.selection.$head, node = backward ? at.nodeBefore : at.nodeAfter;
    if (node && at.parent.inlineContent) {
        const segments = node.isText ? [...graphemes.segment(node.text!)] : [];
        const length = (backward ? segments.at(-1) : segments[0])?.segment.length ?? node.nodeSize;
        view.dispatch(state.tr.delete(at.pos - (backward ? length : 0), at.pos + (backward ? 0 : length)));
        return;
    }
    const commands: Command[] = backward ? [joinBackward, selectNodeBackward] : [joinForward, selectNodeForward];
    commands.some(command => command(state, view.dispatch, view));
}

// The queue belongs to the tab, so switching panes again does not redirect pending input.
export class PendingInput {
    private readonly queue: Input[] = [];
    private editor?: Editor;
    get waiting(): boolean {
 return !!this.queue.length;
}
    attach(editor: Editor): () => void {
        this.editor = editor;
        return () => {
 if (this.editor === editor) this.editor = undefined;
};
    }
    text(value: string): void {
 this.queue.push({ text: value });
}
    key(event: Pick<KeyboardEvent, "key" | "keyCode" | "isComposing" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "getModifierState">): void {
        if (event.isComposing || event.keyCode === 229 || event.key === "Dead" || event.key === "Process") return;
        if ((event.ctrlKey || event.altKey || event.metaKey) && !event.getModifierState("AltGraph")) return;
        const key = event.key;
        if (key === "Backspace" || key === "Delete" || key === "Enter" || key === "Tab") this.queue.push({ key, shift: event.shiftKey });
        else if ([...key].length === 1) this.text(key);
    }
    replay(): void {
        const editor = this.editor;
        if (!editor || editor.isDestroyed) return;
        while (this.queue.length) {
            const next = this.queue[0], { state, view } = editor;
            if ("text" in next) view.dispatch(state.tr.insertText(next.text));
            else if (next.key === "Enter") {
                if (next.shift) editor.commands.insertContent({ type: "hardBreak" });
                else if (!split(state, view.dispatch)) splitBlock(state, view.dispatch);
            }
            else if (next.key === "Tab") {
                if (editor.isActive("pageTable")) {
                    if (next.shift) editor.commands.goToPreviousCell(); else editor.commands.goToNextCell();
                }
                else indent(next.shift)(state, view.dispatch);
            }
            else erase(editor, next.key === "Backspace");
            this.queue.shift();
        }
    }
}