import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

export default Extension.create({
    name: "clearMarksOnEmptyBlock",
    addProseMirrorPlugins() {
        return [new Plugin({
            key: new PluginKey("clearMarksOnEmptyBlock"),
            appendTransaction(transactions, _oldState, state) {
                const {empty, $from} = state.selection;
                if (
                    !empty
                 || !$from.parent.isTextblock
                 || $from.parent.content.size > 0
                 || !state.storedMarks?.length
                ) return null;

                const mapping = new Mapping();
                for (const transaction of transactions) mapping.appendMapping(transaction.mapping);

                let mapIndex = 0;
                for (const transaction of transactions) {
                    for (let index = 0; index < transaction.steps.length; index++) {
                        const remaining = mapping.slice(++mapIndex);
                        let deletedContent = false;

                        // Locate removed inline content at the final cursor, even across multiple steps.
                        transaction.mapping.maps[index].forEach((from, to, newFrom, newTo) => {
                            if (
                                from === to
                             || $from.pos < remaining.map(newFrom, -1)
                             || $from.pos > remaining.map(newTo, 1)
                            ) return;

                            transaction.docs[index].nodesBetween(from, to, node => {
                                if (node.isInline) deletedContent = true;
                                return !deletedContent;
                            });
                        });

                        if (deletedContent) return state.tr.setStoredMarks([]);
                    }
                }

                return null;
            }
        })];
    }
});