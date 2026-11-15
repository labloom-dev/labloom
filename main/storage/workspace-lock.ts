import { closeSync, openSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { LabloomError } from "../../shared/failure";

export type WorkspaceLock = { connection: Database.Database; path: string; created: boolean };

export function acquire(root: string): WorkspaceLock {
    const path = join(root, "workspace.lock");
    let created = false;
    try {
        closeSync(openSync(path, "wx"));
        created = true;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let connection: Database.Database | undefined;
    try {
        connection = new Database(path, { fileMustExist: true, timeout: 0 });
        // Only this metadata-only connection uses an in-memory journal.
        connection.pragma("journal_mode = MEMORY");
        connection.pragma("locking_mode = EXCLUSIVE");
        connection.pragma("user_version = 1");
        return { connection, path, created };
    }
    catch (error) {
        connection?.close();
        const code = (error as { code?: string }).code;
        const inUse = code?.startsWith("SQLITE_BUSY") || code?.startsWith("SQLITE_LOCKED");
        if (created && !inUse) unlinkSync(path);
        if (inUse) throw new LabloomError({ kind: "workspace-in-use" }, { cause: error });
        throw error;
    }
}

export function release(lock: WorkspaceLock, failed = false): void {
    if (lock.connection.open) lock.connection.close();
    if (failed && lock.created) {
        unlinkSync(lock.path);
        lock.created = false;
    }
}