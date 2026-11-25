import type { Editor } from "@tiptap/core";
import { Fragment, type Node as DocNode, type Schema } from "@tiptap/pm/model";
import { type EditorState, type SelectionBookmark, type Transaction } from "@tiptap/pm/state";
import { SvelteMap } from "svelte/reactivity";
import { attachmentURL, type MediaFile } from "../../../shared/content/media";
import { LabloomError, type FailureInfo } from "../../../shared/failure";
import { payload } from "../../../shared/content/blocks";
import type { BlockMedia, EditCommit, MediaKind } from "../../../shared/types/content";
import { failure, message, t } from "../../i18n.svelte";
import { knowledgeState } from "../Knowledge/feedback.svelte";
import type { PageSession } from "../Knowledge/page-session.svelte";
import { blankBlock, blockJSON, documentEdit } from "./document";
import { located } from "./transactions";

type TextRange = { from: number; to: number; text: string };
export type MediaAnchor = { bookmark: SelectionBookmark; text?: TextRange } | { position: number };
type Meter = { current: number; total: number; bytes: number; length?: number };
export type MediaJob = {
    anchor: MediaAnchor; cancel: AbortController; transfer?: string; files: string[]; committing: boolean;
    failures: { name: string; error: FailureInfo }[];
    linkedPapers?: EditCommit["linkedPapers"];
};
type Insertion = (state: EditorState, anchor: MediaAnchor) => Transaction;

export class MediaInsertions {
    readonly jobs = new SvelteMap<MediaJob, Meter | null>();
    constructor(private readonly session: () => PageSession, private readonly readOnly: () => boolean) {}

    get committing(): boolean {
        for (const [job] of this.jobs) if (job.committing) return true;
        return false;
    }

    map(tr: Transaction): void {
        if (!tr.docChanged) return;
        for (const job of this.jobs.keys()) {
            if (job.committing) continue;
            const anchor = job.anchor;
            if ("position" in anchor) anchor.position = tr.mapping.map(anchor.position, 1);
            else {
                anchor.bookmark = anchor.bookmark.map(tr.mapping);
                if (anchor.text) {
                    anchor.text.from = tr.mapping.map(anchor.text.from, 1);
                    anchor.text.to = tr.mapping.map(anchor.text.to, -1);
                }
            }
        }
    }

    async run(editor: Editor, anchor: MediaAnchor, prepare: (job: MediaJob) => Promise<Insertion | undefined>): Promise<void> {
        const job: MediaJob = { anchor, cancel: new AbortController(), files: [], failures: [], committing: false };
        this.jobs.set(job, null);
        const api = window.api.attachments, session = this.session(), signal = job.cancel.signal;
        const progress = api.onTransferProgress(data => {
            const meter = this.jobs.get(job);
            if (job.transfer === data.id && meter) this.jobs.set(job, { ...meter, bytes: data.bytes, length: data.total });
        });
        signal.addEventListener("abort", () => {
            if (job.transfer) void api.cancelTransfer(job.transfer).catch(() => {});
        }, { once: true });
        try {
            const insertion = await prepare(job);
            signal.throwIfAborted();
            if (!editor.isDestroyed && insertion) {
                let edit: ReturnType<typeof documentEdit> | undefined;
                await session.action((token, writeId) => {
                    signal.throwIfAborted();
                    const page = session.state.page;
                    if (!page || page.attributes.deleted || editor.isDestroyed || this.readOnly()) throw new LabloomError({ kind: "page-recycled-readonly" });
                    if (!edit) {
                        const state = editor.state, transaction = insertion(state, job.anchor).setMeta("workspace.paste", true);
                        const next = state.applyTransaction(transaction).state;
                        edit = documentEdit(state.doc, next.doc);
                    }
                    job.committing = true;
                    this.jobs.set(job, null);
                    return window.api.pages.commitEdit({ ...edit, pageId: page.id, batch: 0,
                        ...(job.linkedPapers?.length ? { linkedPapers: job.linkedPapers } : {}) }, session.source, token, writeId);
                });
            }
            if (job.failures.length) knowledgeState.error = { kind: "import-failed",
                diagnostic: job.failures.map(item => item.name + t("dialog.join") + message(item.error)).join("\n") };
        }
        catch (error) {
            if (!signal.aborted) knowledgeState.error = failure(error);
        }
        finally {
            this.jobs.delete(job);
            progress();
            if (job.files.length) await api.releaseHandoffs(job.files).catch(() => {});
        }
    }

    async collect<T, R>(job: MediaJob, inputs: T[], name: (value: T) => string,
        load: (value: T, transfer: string) => Promise<R>): Promise<(R | undefined)[]> {
        const result: (R | undefined)[] = [], signal = job.cancel.signal;
        for (const [index, value] of inputs.entries()) {
            signal.throwIfAborted();
            const key = job.transfer = crypto.randomUUID();
            this.jobs.set(job, { current: index + 1, total: inputs.length, bytes: 0 });
            try {
                result.push(await load(value, key));
            }
            catch (error) {
                signal.throwIfAborted();
                job.failures.push({ name: name(value), error: failure(error) });
                result.push(undefined);
            }
            finally {
                job.transfer = undefined;
            }
        }
        return result;
    }

    progress(job: MediaJob, bytes: number, length: number): void {
        const meter = this.jobs.get(job);
        if (meter) this.jobs.set(job, { ...meter, bytes, length });
    }
}

type Input = { name: string; path: string } | { name: string; blob: Blob };
export function localPaths(paths: string[]): Input[] {
    return paths.map(path => ({ path, name: path.split(/[\\/]/u).at(-1) ?? path }));
}
export function localFiles(files: File[]): Input[] {
    return files.map(file => {
        const path = window.getPathForFile(file);
        return path ? { path, name: file.name } : { blob: file, name: file.name };
    });
}

export async function uploadImage(input: { name: string; blob: Blob }, id: string, signal: AbortSignal,
    progress: (bytes: number, length: number) => void): Promise<MediaFile> {
    const api = window.api.attachments;
    await api.uploadStart(id, input.name, input.blob.type);
    const reader = input.blob.stream().getReader();
    let done = false, bytes = 0;
    try {
        for (;;) {
            signal.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) break;
            await api.uploadChunk(id, chunk.value);
            bytes += chunk.value.length;
            progress(bytes, input.blob.size);
        }
        signal.throwIfAborted();
        const file = await api.uploadFinish(id);
        done = true;
        return file;
    }
    finally {
        await reader.cancel().catch(() => {});
        if (!done) await api.cancelTransfer(id).catch(() => {});
    }
}

export async function copyLocal(input: Input, id: string, job: MediaJob, transfers: MediaInsertions): Promise<MediaFile> {
    const file = "path" in input ? await window.api.attachments.importPath(id, input.path)
        : await uploadImage(input, id, job.cancel.signal, (bytes, length) => transfers.progress(job, bytes, length));
    job.files.push(file.id);
    return file;
}

export async function probeMedia(file: MediaFile, signal: AbortSignal): Promise<{ kind: MediaKind; data: BlockMedia }> {
    const data: BlockMedia = { fileId: file.id }, mime = file.mediaType;
    if (mime.startsWith("image/")) {
        const image = new Image();
        try {
            const ready = await load(image, "load", attachmentURL(file.id), signal);
            if (ready && image.naturalWidth && image.naturalHeight) return {
                kind: "image", data: { ...data, naturalWidth: image.naturalWidth, aspectRatio: image.naturalWidth / image.naturalHeight }
            };
        }
        finally {
            image.removeAttribute("src");
        }
    }
    else if (/^(video|audio)\//u.test(mime)) {
        const video = document.createElement(mime.startsWith("audio/") ? "audio" : "video");
        video.preload = "metadata";
        try {
            const ready = await load(video, "loadedmetadata", attachmentURL(file.id), signal);
            if (ready && video instanceof HTMLAudioElement) return { kind: "video", data };
            if (ready && video instanceof HTMLVideoElement && video.videoWidth && video.videoHeight) return {
                kind: "video", data: { ...data, aspectRatio: video.videoWidth / video.videoHeight }
            };
        }
        finally {
            video.removeAttribute("src");
            video.load();
        }
    }
    return { kind: "file", data };
}

function load(element: HTMLImageElement | HTMLMediaElement, success: string, src: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const listen = new AbortController(), options = { once: true, signal: listen.signal };
        const finish = (ready: boolean): void => {
            listen.abort();
            resolve(ready);
        };
        element.addEventListener(success, () => finish(true), options);
        element.addEventListener("error", () => finish(false), options);
        signal.addEventListener("abort", () => {
            listen.abort();
            reject(signal.reason);
        }, options);
        element.src = src;
    });
}

export function mediaNode(schema: Schema, kind: MediaKind, data: BlockMedia): DocNode {
    return schema.nodeFromJSON(blockJSON({ id: crypto.randomUUID(), type: kind, children: [], payload: { ...payload(kind), media: data } }));
}

export function insertMedia(state: EditorState, anchor: MediaAnchor, nodes: DocNode[]): Transaction {
    const tr = state.tr, content = Fragment.fromArray(nodes);
    if ("position" in anchor) {
        const at = tr.doc.resolve(anchor.position);
        if (!at.parent.inlineContent && at.parent.canReplace(at.index(), at.index(), content)) return tr.insert(at.pos, content);
        const loc = located(state, anchor.position);
        return tr.insert(loc ? loc.pos + loc.node.nodeSize : Math.max(tr.doc.firstChild!.nodeSize, anchor.position), content);
    }
    const selected = anchor.bookmark.resolve(tr.doc);
    const text = anchor.text;
    tr.setSelection(selected);
    if (text && text.from <= text.to && tr.doc.textBetween(text.from, text.to, "\n") === text.text) {
        tr.delete(text.from, text.to);
        tr.setSelection(selected.map(tr.doc, tr.mapping));
    }
    else if (!tr.selection.empty) tr.deleteSelection();
    const loc = located(tr);
    if (!loc) return tr.insert(tr.doc.content.size, content);
    const { node, pos } = loc, end = pos + node.nodeSize, at = tr.selection.$from;
    if (node.type.name !== "pageBlock" || at.parent.type.name !== "blockBody" || at.parent !== node.firstChild)
        return tr.insert(end, content);
    const field = node.firstChild, offset = at.parentOffset;
    if (!field.content.size && node.childCount === 1) return tr.replaceWith(pos, end, content);
    if (text || offset === field.content.size) return tr.insert(end, content);
    if (!offset) return tr.insert(pos, content);
    const left = node.copy(node.content.replaceChild(0, field.copy(field.content.cut(0, offset))));
    const paragraph = blankBlock(state.schema), right = paragraph.copy(Fragment.from(paragraph.firstChild!.copy(field.content.cut(offset))));
    return tr.replaceWith(pos, end, Fragment.from(left).append(content).append(Fragment.from(right)));
}