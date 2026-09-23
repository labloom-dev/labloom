import { Mark, markPasteRule } from "@tiptap/core";
import { markInputRule } from "./markInputRule";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        bold: {
            setBold: () => ReturnType;
            toggleBold: () => ReturnType;
            unsetBold: () => ReturnType;
        };
    }
}

export default Mark.create({
    name: "bold",
    keepOnSplit: false,
    parseHTML() {
        return [
            { tag: "strong" },
            {
                tag: "b",
                getAttrs: element => /^(normal|400)$/.test(element.style.fontWeight) ? false : null
            },
            {
                style: "font-weight=normal",
                clearMark: mark => mark.type.name === this.name
            },
            {
                style: "font-weight=400",
                clearMark: mark => mark.type.name === this.name
            },
            {
                style: "font-weight",
                getAttrs: value => /^(bold(er)?|[5-9]\d{2}|1000)$/.test(value) ? null : false
            }
        ];
    },
    renderHTML: ({ HTMLAttributes }) => ["b", HTMLAttributes, 0],
    addCommands() {
        return {
            setBold: () => ({ commands }) => commands.setMark(this.name),
            toggleBold: () => ({ commands }) => commands.toggleMark(this.name),
            unsetBold: () => ({ commands }) => commands.unsetMark(this.name)
        };
    },
    addKeyboardShortcuts() {
        return {
            "Mod-b": () => this.editor.commands.toggleBold()
        };
    },
    addInputRules() {
        return [markInputRule({
            find: /(?<!\*)\*\*([^\s*](?:[^*\r\n]*[^\s*])?)\*\*(?!\*)$/,
            type: this.type
        })];
    },
    addPasteRules() {
        return [markPasteRule({
            find: /(?<!\*)\*\*([^\s*](?:[^*\r\n]*[^\s*])?)\*\*(?!\*)/g,
            type: this.type
        })];
    }
});