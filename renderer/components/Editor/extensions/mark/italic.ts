import { Mark, markPasteRule } from "@tiptap/core";
import { markInputRule } from "./markInputRule";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        italic: {
            setItalic: () => ReturnType;
            toggleItalic: () => ReturnType;
            unsetItalic: () => ReturnType;
        };
    }
}

export default Mark.create({
    name: "italic",
    keepOnSplit: false,
    parseHTML() {
        return [
            { tag: "em" },
            {
                tag: "i",
                getAttrs: element => element.style.fontStyle === "normal" ? false : null
            },
            {
                style: "font-style=normal",
                clearMark: mark => mark.type.name === this.name
            },
            { style: "font-style=italic" }
        ];
    },
    renderHTML: ({ HTMLAttributes }) => ["i", HTMLAttributes, 0],
    addCommands() {
        return {
            setItalic: () => ({ commands }) => commands.setMark(this.name),
            toggleItalic: () => ({ commands }) => commands.toggleMark(this.name),
            unsetItalic: () => ({ commands }) => commands.unsetMark(this.name)
        };
    },
    addKeyboardShortcuts() {
        return {
            "Mod-i": () => this.editor.commands.toggleItalic()
        };
    },
    addInputRules() {
        return [markInputRule({
            find: /(?<!\*)\*([^\s*](?:[^*\r\n]*[^\s*])?)\*(?!\*)$/,
            type: this.type
        })];
    },
    addPasteRules() {
        return [markPasteRule({
            find: /(?<!\*)\*([^\s*](?:[^*\r\n]*[^\s*])?)\*(?!\*)/g,
            type: this.type
        })];
    }
});