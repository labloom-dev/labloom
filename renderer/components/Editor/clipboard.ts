import { Fragment, Slice, type Schema } from "@tiptap/pm/model";
import { type EditorState } from "@tiptap/pm/state";
import { record, validUUID } from "../../../shared/attrs/values";
import { LabloomError } from "../../../shared/failure";
import type { MediaFile } from "../../../shared/content/media";
import { type BlockMedia, type ContentBlock, type InlineNode } from "../../../shared/types/content";
import { codeLines, documentEdit, subtree, type DocumentEdit } from "./document";
import { copyBlocks, syncInsert, wholeBlocks } from "./transactions";

export type BlockClipboard = { workspaceId: string; slice: Slice; ids: string[]; files?: Record<string, MediaFile> };

export function clipboardMedia(slice: Slice): string[] {
    const ids = new Set<string>();
    slice.content.descendants(node => {
        if (node.type.name === "mediaBlock" && validUUID(node.attrs.media?.fileId)) ids.add(node.attrs.media.fileId);
        return node.type.name === "pageBlock";
    });
    return [...ids];
}

export function writeClipboard(workspaceId: string, slice: Slice, media?: Record<string, MediaFile>): string | null {
    if (!wholeBlocks(slice)) return null;
    const files = media && clipboardMedia(slice).flatMap(id => media[id] ? [[id, media[id]]] : []);
    return JSON.stringify({ workspaceId, slice: slice.toJSON(), ...(files?.length ? { files: Object.fromEntries(files) } : {}) });
}

export function readClipboard(schema: Schema, text: string): BlockClipboard | null {
    try {
        const value: unknown = JSON.parse(text);
        if (!record(value) || typeof value.workspaceId !== "string") return null;
        // Clipboard payloads from older versions stored code in a generic pageBlock.
        function upgrade(node: unknown): void {
            if (!record(node)) return;
            if (node.type === "pageBlock" && record(node.attrs) && node.attrs.kind === "code") {
                node.type = "codeBlock";
                const body = Array.isArray(node.content) && node.content[0];
                node.content = codeLines((body?.content ?? []) as InlineNode[]);
            }
            if (Array.isArray(node.content)) node.content.forEach(upgrade);
        }
        upgrade(value.slice);
        const slice = Slice.fromJSON(schema, value.slice);
        if (!wholeBlocks(slice)) return null;
        const ids = slice.content.content.map(node => node.attrs.blockId as string);
        const files = record(value.files) ? Object.fromEntries(Object.entries(value.files).filter(([id, file]) => validUUID(id)
            && record(file) && file.id === id && typeof file.path === "string" && typeof file.originalName === "string"
            && typeof file.mediaType === "string" && typeof file.size === "number")) as Record<string, MediaFile> : undefined;
        return ids.every(validUUID) ? { workspaceId: value.workspaceId, slice, ids, files } : null;
    }
    catch {
        return null;
    }
}

export function remapClipboardMedia(slice: Slice, files: Map<string, BlockMedia>): Slice {
    function remap(content: Fragment): Fragment {
        return Fragment.fromArray(content.content.map(node => {
            if (node.type.name === "pageBlock") return node.copy(remap(node.content));
            const media = node.type.name === "mediaBlock" && files.get(node.attrs.media?.fileId);
            if (!media) return node;
            const { fileId: _source, name: _name, ...display } = node.attrs.media;
            return node.type.create({ ...node.attrs, media: { ...display, ...media } }, node.content, node.marks);
        }));
    }
    return new Slice(remap(slice.content), slice.openStart, slice.openEnd);
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