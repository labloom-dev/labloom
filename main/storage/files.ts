import { LabloomError } from "../../shared/failure";
import { randomUUID } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { type WorkspaceDatabase } from "./database";
import { type attachments } from "./tables";

type StoredAttachment = typeof attachments.$inferSelect;

export function attachmentPath(root: string, storedName: string): string {
    if (Array.from(storedName).some(char => char.charCodeAt(0) < 32) || basename(storedName) !== storedName || !/^[a-zA-Z0-9-]+(?:\.[^\\/:*?"<>|]+)?$/.test(storedName) || /[. ]$/.test(storedName)) throw new LabloomError({ kind: "attachment-invalid-name" });
    return join(root, "attachments", storedName);
}

/** Actual property values retain files, including properties on recycled pages. */
export function unreferencedFiles(db: WorkspaceDatabase): StoredAttachment[] {
    return db.$client.prepare(`SELECT a.id, a.stored_name AS storedName, a.original_name AS originalName,
        a.media_type AS mediaType, a.size FROM attachments a WHERE a.id NOT IN (
        SELECT f.value FROM page_attrs p JOIN attrs_meta m ON m.id=p.attr_id
        JOIN json_each(CASE m.type WHEN 'file' THEN json_array(p.value) WHEN 'files' THEN p.value ELSE '[]' END) f
        WHERE m.type IN ('file','files') AND f.value IS NOT NULL)`).all() as StoredAttachment[];
}

/** Rename inside the transaction so failed deletion can restore both rows and bytes. */
export function withFileCleanup<T>(db: WorkspaceDatabase, root: string, action: (cleanup: () => void) => T): T {
    const moved: { from: string; to: string }[] = [];
    let result: T;
    try {
        result = db.$client.transaction(() => action(() => {
            for (const file of unreferencedFiles(db)) {
                const from = attachmentPath(root, file.storedName), to = from + ".purge-" + randomUUID();
                if (existsSync(from)) {
                    renameSync(from, to); moved.push({ from, to });
                }
                db.$client.prepare("DELETE FROM link_refs WHERE target_kind='file' AND target_id=?").run(file.id);
                db.$client.prepare("DELETE FROM attachments WHERE id=?").run(file.id);
            }
        }))();
    }
    catch (error) {
        for (const file of moved.reverse()) renameSync(file.to, file.from);
        throw error;
    }
    for (const file of moved) unlinkSync(file.to);
    return result;
}