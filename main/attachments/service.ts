import { randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { LabloomError } from "../../shared/failure";
import { type Attachment } from "../../shared/types/papers";
import * as events from "../knowledge/events";
import { type WorkspaceDatabase } from "../storage/database";
import { attachmentPath } from "../storage/files";
import { attachments } from "../storage/tables";
import * as workspace from "../workspace-state";
import * as transfer from "./download";
import * as metadata from "./metadata";

type StoredAttachment = typeof attachments.$inferSelect;
type Store = (info: metadata.Metadata, place: (target: string) => void, validate?: (target: string) => void) => Attachment;

function storing<T>(action: (store: Store) => T): T {
    const created: string[] = [], db = workspace.database();
    try {
        return action((info, place, validate) => {
            const id = randomUUID(), storedName = id + (extname(info.originalName) || metadata.suffixFor(info.mediaType));
            const target = attachmentPath(workspace.root(), storedName);
            mkdirSync(join(workspace.root(), "attachments"), { recursive: true });
            place(target);
            created.push(target);
            validate?.(target);
            const file = { id, ...info, size: statSync(target).size };
            db.insert(attachments).values({ ...file, storedName }).run();
            return file;
        });
    }
    catch (error) {
        for (const path of created) unlinkSync(path);
        throw error;
    }
}

// Local imports accept the PDF signature within the first 1024 bytes, as before.
function checkLocalPDF(path: string): void {
    const fd = openSync(path, "r");
    try {
        const header = Buffer.alloc(1024);
        const length = readSync(fd, header, 0, header.length, 0);
        if (!header.subarray(0, length).includes(transfer.pdfHeader)) throw new LabloomError({ kind: "pdf-invalid" });
    }
    finally {
        closeSync(fd);
    }
}

export function importing<T>(action: (store: (path: string) => Attachment) => T): T {
    return storing(store => action(path => {
        const originalName = basename(path), mediaType = metadata.typeFor(originalName) ?? metadata.binary;
        return store({ originalName, mediaType }, target => copyFileSync(path, target, constants.COPYFILE_EXCL),
            mediaType === "application/pdf" ? checkLocalPDF : undefined);
    }));
}

// Downloaded files have no page owner until a renderer commits its edit.
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

export async function download(url: string, options: transfer.DownloadOptions = {}): Promise<string | null> {
    const session = workspace.requireWorkspace();
    try {
        const id = await transfer.receive(url, {
            ...options, directory: join(session.info.path, "attachments"), fetcher: session.fetchAttachment, signal: session.controller.signal
        }, (path, info) => {
            const file = storing(store => store(info, target => renameSync(path, target)));
            protect(file.id, session.db);
            return file.id;
        });
        return workspace.isCurrent(session) ? id : null;
    }
    catch (error) {
        if (!workspace.isCurrent(session)) return null;
        throw error;
    }
}

// Watch committed property references only while a downloaded file is waiting for an owner.
function protect(id: string, db: WorkspaceDatabase): void {
    handedOut.add(id);
    if (stopWatching) return;
    const references = db.$client.prepare(`SELECT DISTINCT target_id FROM link_refs WHERE source_kind='page'
        AND source_id IN (SELECT value FROM json_each(?)) AND target_kind='file'`).pluck();
    stopWatching = events.subscribe(event => {
        if (event.type !== "knowledge" || !event.change.pages.length) return;
        for (const file of references.all(JSON.stringify(event.change.pages)) as string[]) handedOut.delete(file);
        if (!handedOut.size) release();
    });
}

/** Actual property values retain files, including properties on recycled pages. */
export function unreferencedFiles(db: WorkspaceDatabase): StoredAttachment[] {
    return db.$client.prepare(`SELECT a.id, a.stored_name AS storedName, a.original_name AS originalName,
        a.media_type AS mediaType, a.size FROM attachments a WHERE a.id NOT IN (
        SELECT f.value FROM page_attrs p JOIN attrs_meta m ON m.id=p.attr_id
        JOIN json_each(CASE m.type WHEN 'file' THEN json_array(p.value) WHEN 'files' THEN p.value ELSE '[]' END) f
        WHERE m.type IN ('file','files') AND f.value IS NOT NULL)`).all() as StoredAttachment[];
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