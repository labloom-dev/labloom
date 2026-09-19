import { mergeAttributes } from "@tiptap/core";
import _Paragraph from "@tiptap/extension-paragraph";

const Paragraph = _Paragraph.extend({
    draggable: false,
    parseHTML: () => [
        {tag: "div.dc-paragraph"},
        {tag: "div"},
        {tag: "p"}
    ],
    renderHTML: ({HTMLAttributes}) => ["div", mergeAttributes(HTMLAttributes, {class: "dc-paragraph"}), 0]
});

export default Paragraph;