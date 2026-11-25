import { dialog, type BrowserWindow } from "electron";
import { TransformStream, type WritableStreamDefaultWriter } from "node:stream/web";
import typia from "typia";
import { attachmentProgress, attachmentsChannels, type AttachmentsAPI } from "../../shared/attachments/ipc";
import { validUUID } from "../../shared/attrs/values";
import type { MediaFile } from "../../shared/content/media";
import { LabloomError } from "../../shared/failure";
import { invalid, register, route, type Routes } from "../ipc";
import { t } from "../ui/i18n";
import { selectPDF } from "../ui/fileDialogs";
import * as workspace from "../workspace-state";
import { extensionsFor } from "./metadata";
import * as service from "./service";

export function registerAttachmentIPCs(window: BrowserWindow): void {
    type Args<K extends keyof AttachmentsAPI> = Parameters<AttachmentsAPI[K]>;
    type Upload = { writer: WritableStreamDefaultWriter<Uint8Array>; result: Promise<MediaFile> };
    const tasks = new Map<string, { cancel: AbortController; upload?: Upload }>();
    function start(id: string): AbortController {
        if (!validUUID(id) || tasks.has(id)) throw new LabloomError({ kind: "invalid-argument" });
        const cancel = new AbortController();
        tasks.set(id, { cancel });
        return cancel;
    }
    function cancelTransfer(id: string): void {
        const task = tasks.get(id);
        task?.cancel.abort(new LabloomError({ kind: "attachment-transfer-ended" }));
        if (task?.upload) tasks.delete(id);
    }
    window.webContents.once("destroyed", () => {
        for (const id of tasks.keys()) cancelTransfer(id);
    });
    function progress(id: string): (bytes: number, total?: number) => void {
        let last = -Infinity;
        return (bytes, total) => {
            const now = performance.now();
            if (now - last < 80 && bytes !== total || window.isDestroyed()) return;
            last = now;
            window.webContents.send(attachmentProgress, { id, bytes, total });
        };
    }
    function upload(id: string): Upload {
        const entry = tasks.get(id)?.upload;
        if (!entry) throw new LabloomError({ kind: "attachment-transfer-ended" });
        return entry;
    }
    const routes: Routes<AttachmentsAPI> = {
        available: route(typia.createAssert<Args<"available">>(invalid), service.available),
        saveAs: route(typia.createAssert<Args<"saveAs">>(invalid), id => service.saveAs(id, async name => {
            const result = await dialog.showSaveDialog(window, { defaultPath: name });
            return result.canceled ? undefined : result.filePath;
        })),
        choose: route(typia.createAssert<Args<"choose">>(invalid), async (...[kind, multiple = true]) => {
            if (kind === "pdf") return selectPDF(window);
            const result = await dialog.showOpenDialog(window, { properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
                ...(kind === "file" ? {} : { filters: [{ name: t(kind === "image" ? "dialog.imageFilter" : "dialog.videoFilter"), extensions: extensionsFor(kind) }] }) });
            return result.canceled ? [] : result.filePaths;
        }),
        stagePaths: route(typia.createAssert<Args<"stagePaths">>(invalid), service.stagePaths),
        importPath: route(typia.createAssert<Args<"importPath">>(invalid), async (...[id, path, source]) => {
            const cancel = start(id);
            try {
                return await service.importPath(path, { source, signal: cancel.signal, progress: progress(id) });
            }
            finally {
                tasks.delete(id);
            }
        }),
        downloadImage: route(typia.createAssert<Args<"downloadImage">>(invalid), async (id, url) => {
            const cancel = start(id);
            try {
                const file = await service.downloadFile(url, { expectedType: "image/*", signal: cancel.signal, progress: progress(id) });
                if (!file) throw new LabloomError({ kind: "attachment-transfer-ended" });
                return file;
            }
            finally {
                tasks.delete(id);
            }
        }),
        uploadStart: route(typia.createAssert<Args<"uploadStart">>(invalid), (id, name, type) => {
            const session = workspace.requireWorkspace(), cancel = start(id);
            const signal = AbortSignal.any([session.controller.signal, cancel.signal]);
            const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
            const writer = writable.getWriter();
            const abort = (): void => {
                void writer.abort(signal.reason).catch(() => {});
                tasks.delete(id);
            };
            try {
                const result = service.importImage(name, type, readable, signal);
                tasks.set(id, { cancel, upload: { writer, result } });
                signal.addEventListener("abort", abort, { once: true });
                void result.catch(error => writer.abort(error).catch(() => {})).finally(() => signal.removeEventListener("abort", abort));
            }
            catch (error) {
                tasks.delete(id);
                throw error;
            }
        }),
        uploadChunk: route(typia.createAssert<Args<"uploadChunk">>(invalid), (id, bytes) => upload(id).writer.write(bytes)),
        uploadFinish: route(typia.createAssert<Args<"uploadFinish">>(invalid), async id => {
            const { writer, result } = upload(id);
            try {
                await writer.close().catch(() => {});
                return await result;
            }
            finally {
                tasks.delete(id);
            }
        }),
        cancelTransfer: route(typia.createAssert<Args<"cancelTransfer">>(invalid), cancelTransfer),
        releaseHandoffs: route(typia.createAssert<Args<"releaseHandoffs">>(invalid), service.releaseHandoffs)
    };
    register(window.webContents, attachmentsChannels, routes);
}