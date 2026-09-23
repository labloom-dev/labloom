import { Mark, markPasteRule } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { markInputRule } from "./markInputRule";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        code: {
            setCode: () => ReturnType;
            toggleCode: () => ReturnType;
            unsetCode: () => ReturnType;
        };
    }
}

export default Mark.create({
    name: "code",
    // Keep code outermost during normal rendering.
    priority: Infinity,
    // Keep input rules active so nested marks can finish around or inside code.
    code: false,
    exitable: true,
    keepOnSplit: false,
    parseHTML() {
        return [{ tag: "code" }];
    },
    renderHTML: ({ HTMLAttributes }) => ["code", HTMLAttributes, 0],
    addMarkView() {
        return ({ view, HTMLAttributes }) => {
            const { dom } = DOMSerializer.renderSpec(view.dom.ownerDocument, ["code", HTMLAttributes, 0]);
            return {
                dom: dom as HTMLElement,
                // These attributes only join temporary composition fragments visually.
                ignoreMutation: mutation => mutation.type === "attributes" && mutation.target === dom && (
                    mutation.attributeName === "data-code-join-start" || mutation.attributeName === "data-code-join-end"
                )
            };
        };
    },
    addProseMirrorPlugins() {
        return [new Plugin({
            view(view) {
                const update = (): void => {
                    // Keep the IME's DOM intact. Text between code nodes must remain a gap.
                    for (const code of view.dom.querySelectorAll("code")) {
                        code.toggleAttribute("data-code-join-start", code.previousSibling?.nodeName === "CODE");
                        code.toggleAttribute("data-code-join-end", code.nextSibling?.nodeName === "CODE");
                    }
                };
                update();
                return { update };
            }
        })];
    },
    addCommands() {
        return {
            setCode: () => ({ commands }) => commands.setMark(this.name),
            toggleCode: () => ({ commands }) => commands.toggleMark(this.name),
            unsetCode: () => ({ commands }) => commands.unsetMark(this.name)
        };
    },
    addKeyboardShortcuts() {
        return {
            "Mod-e": () => this.editor.commands.toggleCode()
        };
    },
    addInputRules() {
        return [markInputRule({
            find: /(?<!`)`([^`\r\n]+)`(?!`)$/,
            type: this.type
        })];
    },
    addPasteRules() {
        return [markPasteRule({
            find: /(?<!`)`([^`\r\n]+)`(?!`)/g,
            type: this.type
        })];
    }
});