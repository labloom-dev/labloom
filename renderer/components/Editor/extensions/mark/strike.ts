import { Mark, markPasteRule } from "@tiptap/core";
import { markInputRule } from "./markInputRule";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        strike: {
            setStrike: () => ReturnType;
            toggleStrike: () => ReturnType;
            unsetStrike: () => ReturnType;
        };
    }
}

export default Mark.create({
    name: "strike",
    keepOnSplit: false,
    parseHTML() {
        return [
            { tag: "s" },
            { tag: "del" },
            { tag: "strike" },
            {
                style: "text-decoration",
                consuming: false,
                getAttrs: value => value.split(/\s+/).includes("line-through") ? null : false
            },
            {
                style: "text-decoration-line",
                consuming: false,
                getAttrs: value => value.split(/\s+/).includes("line-through") ? null : false
            }
        ];
    },
    renderHTML: ({ HTMLAttributes }) => ["s", HTMLAttributes, 0],
    addCommands() {
        return {
            setStrike: () => ({ commands }) => commands.setMark(this.name),
            toggleStrike: () => ({ commands }) => commands.toggleMark(this.name),
            unsetStrike: () => ({ commands }) => commands.unsetMark(this.name)
        };
    },
    addKeyboardShortcuts() {
        return {
            "Mod-s": () => this.editor.commands.toggleStrike()
        };
    },
    addInputRules() {
        return [markInputRule({
            find: /(?<!~)~~([^\s~](?:[^~\r\n]*[^\s~])?)~~(?!~)$/,
            type: this.type
        })];
    },
    addPasteRules() {
        return [markPasteRule({
            find: /(?<!~)~~([^\s~](?:[^~\r\n]*[^\s~])?)~~(?!~)/g,
            type: this.type
        })];
    }
});