import { Extension } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";

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
    addCommands() {
        return {
            appendParagraph: () => ({ dispatch, state, commands}) => {
                if(!dispatch) return true;
                commands.insertContentAt(state.doc.content.size, {type: "paragraph"});
                return true;
            },
            setSelectionToEnd: () => ({ dispatch, tr, state }) => {
                if(!dispatch) return true;
                tr.setSelection(Selection.atEnd(state.doc));
                return true;
            }
        };
    }
});