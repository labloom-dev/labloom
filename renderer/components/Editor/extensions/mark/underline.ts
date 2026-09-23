import { Mark, markPasteRule } from "@tiptap/core";
import { markInputRule } from "./markInputRule";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        underline: {
            setUnderline: () => ReturnType;
            toggleUnderline: () => ReturnType;
            unsetUnderline: () => ReturnType;
        };
    }
}

export default Mark.create({
    name: "underline",
    keepOnSplit: false,
    parseHTML() {
        return [
            { tag: "u" },
            {
                style: "text-decoration",
                consuming: false,
                getAttrs: value => value.split(/\s+/).includes("underline") ? null : false
            },
            {
                style: "text-decoration-line",
                consuming: false,
                getAttrs: value => value.split(/\s+/).includes("underline") ? null : false
            }
        ];
    },
    renderHTML: ({ HTMLAttributes }) => ["u", HTMLAttributes, 0],
    addCommands() {
        return {
            setUnderline: () => ({ commands }) => commands.setMark(this.name),
            toggleUnderline: () => ({ commands }) => commands.toggleMark(this.name),
            unsetUnderline: () => ({ commands }) => commands.unsetMark(this.name)
        };
    },
    addKeyboardShortcuts() {
        return {
            "Mod-u": () => this.editor.commands.toggleUnderline()
        };
    },
    addInputRules() {
        return [markInputRule({
            find: /(?<!_)_([^\s_](?:[^_\r\n]*[^\s_])?)_(?!_)$/,
            type: this.type
        })];
    },
    addPasteRules() {
        return [markPasteRule({
            find: /(?<!_)_([^\s_](?:[^_\r\n]*[^\s_])?)_(?!_)/g,
            type: this.type
        })];
    }
});