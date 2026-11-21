import { Fragment } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { ContentBlockKind } from "../../../shared/types/content";
import type { InlineNode } from "../../../shared/types/content";
import { blankBlock, canNest, codeLines } from "./document";
import { located, selectionIn } from "./transactions";

const prefixes: Record<string, ContentBlockKind> = { "# ": "heading_1", "## ": "heading_2", "### ": "heading_3",
    "- ": "unordered_list", "* ": "unordered_list", "+ ": "unordered_list", "> ": "blockquote", "```": "code", "---": "hr" };

export function inputAction(state: EditorState, from: number, to: number, text: string): ContentBlockKind | "inline" | undefined {
    const at = state.doc.resolve(from), loc = located(state, from);
    if (!loc || from !== to || !at.parent.inlineContent || loc.node.type.name === "codeBlock" || loc.node.attrs.kind === "code") return;
    if (at.parent.type.contentMatch.matchType(state.schema.nodes.inlineReference) &&
        (at.parent.textBetween(Math.max(0, at.parentOffset - 2), at.parentOffset, "", "\n") + text).endsWith("[[")) return "inline";
    if (loc.node.attrs.kind !== "paragraph" || ![" ", "-", "`", ""].includes(text.slice(-1))) return;
    const prefix = at.parent.textBetween(0, at.parentOffset, "", "\n") + text;
    const kind = /^\d+\. $/u.test(prefix) ? "ordered_list" : prefixes[prefix];
    return kind && (loc.node.childCount === 1 || canNest(kind)) ? kind : undefined;
}

export function convertPrefix(state: EditorState, kind: ContentBlockKind): Transaction {
    const { pos, node } = located(state)!, field = node.firstChild!;
    const rest = field.copy(field.content.cut(state.selection.$head.parentOffset));
    const tr = state.tr;
    if (kind === "hr") {
        const rule = state.schema.nodes.hr.create({ blockId: node.attrs.blockId });
        const next = blankBlock(state.schema).copy(Fragment.from(rest));
        tr.replaceWith(pos, pos + node.nodeSize, [rule, next]);
        return selectionIn(tr, pos + rule.nodeSize + 2);
    }
    const converted = kind === "code" ? state.schema.nodeFromJSON({ type: "codeBlock", attrs: { blockId: node.attrs.blockId },
        content: codeLines((rest.content.toJSON() ?? []) as InlineNode[]) }) :
        node.type.create({ ...node.attrs, kind }, node.content.replaceChild(0, rest));
    return selectionIn(tr.replaceWith(pos, pos + node.nodeSize, converted), pos + 2);
}

export function restoreLiteral(state: EditorState, before: EditorState): Transaction {
    const { doc } = state, from = doc.content.findDiffStart(before.doc.content)!;
    const end = doc.content.findDiffEnd(before.doc.content)!;
    const overlap = Math.max(0, from - Math.min(end.a, end.b));
    const tr = state.tr.replace(from, end.a + overlap, before.doc.slice(from, end.b + overlap));
    return tr.setSelection(TextSelection.create(tr.doc, before.selection.head));
}