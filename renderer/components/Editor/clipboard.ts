import { Fragment, Slice, type Schema } from "@tiptap/pm/model";
import { type EditorState } from "@tiptap/pm/state";
import { record, validUUID } from "../../../shared/attrs/values";
import { LabloomError } from "../../../shared/failure";
import { type ContentBlock } from "../../../shared/types/content";
import { documentEdit, subtree, type DocumentEdit } from "./document";
import { copyBlocks, syncInsert, wholeBlocks } from "./transactions";

export type BlockClipboard = { workspaceId: string; slice: Slice; ids: string[] };

export function writeClipboard(workspaceId: string, slice: Slice): string | null {
    return wholeBlocks(slice) ? JSON.stringify({ workspaceId, slice: slice.toJSON() }) : null;
}

export function readClipboard(schema: Schema, text: string): BlockClipboard | null {
    try {
        const value: unknown = JSON.parse(text);
        if (!record(value) || typeof value.workspaceId !== "string") return null;
        const slice = Slice.fromJSON(schema, value.slice);
        if (!wholeBlocks(slice)) return null;
        const ids = slice.content.content.map(node => node.attrs.blockId as string);
        return ids.every(validUUID) ? { workspaceId: value.workspaceId, slice, ids } : null;
    }
    catch {
        return null;
    }
}

/** Plan one atomic paste; only containers are written for a synchronous paste. */
export function pasteBlocks(state: EditorState, clipboard: BlockClipboard, current?: ContentBlock[]): { edit: DocumentEdit; selection: number } {
    const blocks = new Map(current?.map(block => [block.id, block]));
    const tree = Object.fromEntries(blocks);
    const slice = current
        ? new Slice(Fragment.fromArray(clipboard.ids.map(id => state.schema.nodeFromJSON(subtree(id, tree)))), 0, 0)
        : copyBlocks(clipboard.slice);
    const transaction = state.tr.replaceSelection(slice).setMeta("workspace.paste", true);
    if (current) transaction.setMeta(syncInsert, [...blocks.keys()]);
    const next = state.applyTransaction(transaction).state;
    const edit = documentEdit(state.doc, next.doc);
    if (current) {
        for (const block of edit.blocks) {
            const original = blocks.get(block.id);
            if (original && JSON.stringify(original.children) !== JSON.stringify(block.children)) throw new LabloomError({ kind: "block-cycle" });
        }
        edit.blocks = edit.blocks.filter(block => !blocks.has(block.id));
    }
    return { edit, selection: next.selection.from };
}