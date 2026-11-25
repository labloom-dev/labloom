import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { lstat, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { validUUID } from "../../shared/attrs/values";
import type { AttachmentBatch } from "../../shared/attachments/ipc";
import type { MediaFile } from "../../shared/content/media";
import { LabloomError, toFailureInfo } from "../../shared/failure";
import * as events from "../knowledge/events";
import { statement } from "../knowledge/records";
import { type WorkspaceDatabase } from "../storage/database";
import { attachmentPath } from "../storage/files";
import { attachments } from "../storage/tables";
import * as workspace from "../workspace-state";
import * as transfer from "./download";
import * as metadata from "./metadata";

type StoredAttachment = typeof attachments.$inferSelect;
export function storedAttachment(id: string): StoredAttachment | undefined {
    return statement(`SELECT id, stored_name AS storedName, original_name AS originalName, media_type AS mediaType, size
        FROM attachments WHERE id=?`).get(id) as StoredAttachment | undefined;
}

export async function available(id: string): Promise<boolean> {
    if (!workspace.ready() || !validUUID(id)) return false;
    const session = workspace.requireWorkspace(), file = storedAttachment(id);
    if (!file) return false;
    const stat = await lstat(attachmentPath(session.info.path, file.storedName)).catch(() => null);
    return workspace.isCurrent(session) && !!stat?.isFile() && stat.size === file.size;
}

export async function saveAs(id: string, select: (name: string) => Promise<string | undefined>): Promise<void> {
    const session = workspace.requireWorkspace(), file = validUUID(id) && storedAttachment(id);
    if (!file || !await available(id)) throw new LabloomError({ kind: "attachment-missing" });
    if (!workspace.isCurrent(session)) return;
    const destination = await select(file.originalName);
    if (!destination || !workspace.isCurrent(session)) return;
    const mediaDirectory = await realpath(join(session.info.path, "attachments"));
    const directory = await realpath(dirname(destination)), within = relative(mediaDirectory, directory);
    if (!within || !isAbsolute(within) && within !== ".." && !within.startsWith(".." + sep)) throw new LabloomError({ kind: "attachment-save-directory" });
    const temporary = join(directory, ".labloom-save-" + randomUUID() + ".part");
    const signal = session.controller.signal;
    try {
        await pipeline(createReadStream(attachmentPath(session.info.path, file.storedName)), createWriteStream(temporary, { flags: "wx" }), { signal });
        signal.throwIfAborted();
        await rename(temporary, destination);
    }
    finally {
        await rm(temporary, { force: true });
    }
}
type Store = (info: metadata.Metadata, path: string) => MediaFile;

function storing<T>(action: (store: Store) => T): T {
    const created: string[] = [], db = workspace.database();
    try {
        return action((info, path) => {
            const id = randomUUID(), storedName = id + (extname(info.originalName) || metadata.suffixFor(info.mediaType));
            const target = attachmentPath(workspace.root(), storedName);
            renameSync(path, target);
            try {
                const file = { id, ...info, size: statSync(target).size };
                db.insert(attachments).values({ ...file, storedName }).run();
                created.push(target);
                return { ...file, path: target };
            }
            catch (error) {
                unlinkSync(target);
                throw error;
            }
        });
    }
    catch (error) {
        for (const path of created) unlinkSync(path);
        throw error;
    }
}

// Stored files wait here until a renderer commits a reference.
const handedOut = new Set<string>();
let stopWatching: (() => void) | undefined;
export function release(): void {
    stopWatching?.();
    stopWatching = undefined;
    handedOut.clear();
}

export function recoverDownloads(): void {
    transfer.discardInterrupted(join(workspace.root(), "attachments"));
}

function publish(path: string, info: metadata.Metadata, session: workspace.WorkspaceState, signal: AbortSignal): MediaFile {
    signal.throwIfAborted();
    const file = storing(store => store(info, path));
    protect(file.id, session.db);
    return file;
}

export async function downloadFile(url: string, options: transfer.DownloadOptions = {}): Promise<MediaFile | null> {
    const session = workspace.requireWorkspace();
    const signal = options.signal ? AbortSignal.any([session.controller.signal, options.signal]) : session.controller.signal;
    try {
        const file = await transfer.receive(url, {
            ...options, directory: join(session.info.path, "attachments"), fetcher: session.fetchAttachment, signal
        }, (path, info) => publish(path, info, session, signal));
        return workspace.isCurrent(session) ? file : null;
    }
    catch (error) {
        if (!workspace.isCurrent(session)) return null;
        throw error;
    }
}

export async function download(url: string, options?: transfer.DownloadOptions): Promise<string | null> {
    return (await downloadFile(url, options))?.id ?? null;
}

type Progress = (bytes: number, total?: number) => void;
type SourceFile = Pick<MediaFile, "id" | "originalName" | "mediaType">;

// Local imports accept a PDF signature within the first 1024 bytes.
async function checkPDF(path: string): Promise<void> {
    const handle = await open(path, "r");
    try {
        const header = Buffer.alloc(1024), { bytesRead } = await handle.read(header, 0, header.length, 0);
        if (!header.subarray(0, bytesRead).includes(transfer.pdfHeader)) throw new LabloomError({ kind: "pdf-invalid" });
    }
    finally {
        await handle.close();
    }
}

type PathOptions = { signal?: AbortSignal; progress?: Progress; source?: SourceFile; pdfOnly?: boolean };
export async function importPath(path: string, options: PathOptions = {}): Promise<MediaFile> {
    const session = workspace.requireWorkspace();
    const signal = options.signal ? AbortSignal.any([session.controller.signal, options.signal]) : session.controller.signal;
    const file = await preparePath(path, session.info.path, signal, options);
    try {
        return publish(file.path, file.info, session, signal);
    }
    finally {
        await file.discard();
    }
}

type StagedPath = { path: string; discard: () => Promise<void>; info: metadata.Metadata };
async function preparePath(path: string, root: string, signal: AbortSignal, { source, progress, pdfOnly }: PathOptions = {}): Promise<StagedPath> {
    if (!isAbsolute(path)) throw new LabloomError({ kind: "import-regular-file" });
    if (source) {
        const directory = dirname(path), name = basename(path);
        if (!validUUID(source.id) || basename(directory) !== "attachments" || ![source.id, source.id + extname(name)].includes(name))
            throw new LabloomError({ kind: "attachment-missing" });
    }
    const originalName = source ? metadata.safeName(source.originalName) || basename(path) : basename(path);
    const mediaType = source?.mediaType || metadata.typeFor(originalName) || metadata.binary;
    const info = { originalName, mediaType };
    const size = await (source ? lstat(path) : stat(path)).then(entry => {
        if (!entry.isFile()) throw new LabloomError({ kind: "import-regular-file" });
        return entry.size;
    });
    if (pdfOnly && mediaType !== "application/pdf") throw new LabloomError({ kind: "import-pdf-only" });
    signal.throwIfAborted();
    progress?.(0, size);
    async function* chunks(): AsyncGenerator<Uint8Array> {
        let bytes = 0;
        for await (const chunk of createReadStream(path, { signal, highWaterMark: 256 * 1024 })) {
            yield chunk as Buffer;
            bytes += chunk.length;
            progress?.(bytes, size);
        }
    }
    const file = await transfer.stageFile(join(root, "attachments"), chunks());
    if (mediaType === "application/pdf") {
        try {
            await checkPDF(file.path);
        }
        catch (error) {
            await file.discard();
            throw error;
        }
    }
    return { ...file, info };
}

export async function stagePaths(paths: string[], pdfOnly: boolean, atomic = false): Promise<AttachmentBatch> {
    const session = workspace.requireWorkspace(), signal = session.controller.signal;
    const pending: StagedPath[] = [], failures: AttachmentBatch["failures"] = [];
    try {
        for (const path of paths) {
            signal.throwIfAborted();
            try {
                pending.push(await preparePath(path, session.info.path, signal, { pdfOnly }));
            }
            catch (error) {
                if (atomic || signal.aborted) throw error;
                failures.push({ name: basename(path), error: toFailureInfo(error) });
            }
        }
        signal.throwIfAborted();
        const files = storing(store => session.database.transaction(() => pending.map(file => store(file.info, file.path)))());
        for (const file of files) protect(file.id, session.db);
        return { files: files.map(({ path: _path, ...file }) => file), failures };
    }
    finally {
        await Promise.all(pending.map(file => file.discard()));
    }
}

export function importImage(name: string, mediaType: string, chunks: AsyncIterable<Uint8Array>, cancel: AbortSignal): Promise<MediaFile> {
    const session = workspace.requireWorkspace(), signal = AbortSignal.any([session.controller.signal, cancel]);
    if (!/^image\/[a-z0-9.+-]+$/i.test(mediaType)) throw new LabloomError({ kind: "attachment-image-required" });
    const originalName = metadata.safeName(name) || "image" + metadata.suffixFor(mediaType);
    return transfer.stage(join(session.info.path, "attachments"), chunks, target => publish(target, { originalName, mediaType }, session, signal));
}

export function releaseHandoffs(ids: string[]): void {
    for (const id of ids) handedOut.delete(id);
    if (!handedOut.size) release();
}

// Watch committed references while an imported file is waiting to be linked.
function protect(id: string, db: WorkspaceDatabase): void {
    handedOut.add(id);
    if (stopWatching) return;
    const references = db.$client.prepare(`SELECT target_id FROM link_refs l JOIN json_each(?) j
        ON l.source_kind=? AND l.source_id=j.value WHERE l.target_kind='file'`).pluck();
    stopWatching = events.subscribe(event => {
        if (event.type !== "knowledge") return;
        for (const [kind, ids] of [["page", event.change.pages], ["block", event.change.blocks]] as const) {
            if (ids.length) for (const file of references.all(JSON.stringify(ids), kind) as string[]) handedOut.delete(file);
        }
        if (!handedOut.size) release();
    });
}

/** Properties and retained blocks on both live and recycled pages can hold files. */
export function unreferencedFiles(db: WorkspaceDatabase): StoredAttachment[] {
    return db.$client.prepare(`SELECT a.id, a.stored_name AS storedName, a.original_name AS originalName,
        a.media_type AS mediaType, a.size FROM attachments a WHERE a.id NOT IN (
        SELECT f.value FROM page_attrs p JOIN attrs_meta m ON m.id=p.attr_id
        JOIN json_each(CASE m.type WHEN 'file' THEN json_array(p.value) WHEN 'files' THEN p.value ELSE '[]' END) f
        WHERE m.type IN ('file','files') AND f.value IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM link_refs l WHERE l.target_kind='file' AND l.target_id=a.id AND l.source_kind='block')`).all() as StoredAttachment[];
}

/** Collect irreversible garbage together; failed deletion restores rows and bytes. */
export function withFileCleanup<T>(db: WorkspaceDatabase, root: string, action: (cleanup: (blocks: string[]) => string[]) => T): T {
    const moved: { from: string; to: string }[] = [];
    let result: T;
    try {
        result = db.$client.transaction(() => action(blocks => {
            if (blocks.length) db.$client.prepare("DELETE FROM blocks WHERE id IN (SELECT value FROM json_each(?))").run(JSON.stringify(blocks));
            for (const file of unreferencedFiles(db)) {
                if (handedOut.has(file.id)) continue;
                const from = attachmentPath(root, file.storedName), to = from + ".purge-" + randomUUID();
                if (existsSync(from)) {
                    renameSync(from, to); moved.push({ from, to });
                }
                db.$client.prepare("DELETE FROM link_refs WHERE target_kind='file' AND target_id=?").run(file.id);
                db.$client.prepare("DELETE FROM attachments WHERE id=?").run(file.id);
            }
            return blocks;
        }))();
    }
    catch (error) {
        for (const file of moved.reverse()) renameSync(file.to, file.from);
        throw error;
    }
    for (const file of moved) unlinkSync(file.to);
    return result;
}