import { Extension } from "@tiptap/core";
import { Plugin, Selection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        trailingParagraph: {
            appendParagraph :() => ReturnType;
            setSelectionToEnd :() => ReturnType;
        };
    }
}

export default Extension.create({
    name: "trailingParagraph",
    addProseMirrorPlugins() {
        return [new Plugin({
            props: {
                handleDOMEvents: {
                    mousedown: (view, event) => {
                        if (!view.editable || event.button !== 0 || event.target !== view.dom) return false;

                        const last = view.state.doc.lastChild;
                        if (!last) return false;
                        const lastDOM = view.nodeDOM(view.state.doc.content.size - last.nodeSize);
                        if (!(lastDOM instanceof HTMLElement) || event.clientY < lastDOM.getBoundingClientRect().bottom) return false;

                        event.preventDefault();
                        const chain = this.editor.chain();
                        if (!last.isTextblock || last.content.size > 0) chain.appendParagraph();
                        chain.setSelectionToEnd().scrollIntoView().run();
                        view.focus();
                        return true;
                    }
                }
            }
        })];
    },
    addCommands() {
        return {
            appendParagraph: () => ({ dispatch, state, commands}) => {
                if(!dispatch) return true;
                commands.insertContentAt(state.doc.content.size, {type: "paragraph"});
                return true;
            },
            setSelectionToEnd: () => ({ dispatch, tr }) => {
                if(!dispatch) return true;
                tr.setSelection(Selection.atEnd(tr.doc));
                return true;
            }
        };
    }
});