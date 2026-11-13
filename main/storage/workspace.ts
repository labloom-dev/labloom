import { LabloomError } from "../../shared/failure";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import type { Workspace } from "../../shared/types/startup";
import { createWorkspaceSchema, validateWorkspaceSchema } from "./schema";
import { initializeBuiltinAttrs, validateBuiltinAttrs } from "./builtin-attrs";
import { createWorkspaceDatabase, type WorkspaceDatabase } from "./database";
import { withFileCleanup } from "./files";
import { workspaceMeta } from "./tables";
import { diagnostic, toFailureInfo } from "../../shared/failure";

const applicationId = 0x4c424c4d;

export type OpenWorkspace = {
    info: Workspace;
    database: Database.Database;
    db: WorkspaceDatabase;
};

function directoryPath(path: string): string {
    try {
        const resolved = realpathSync(path);
        if (!statSync(resolved).isDirectory()) throw new LabloomError({ kind: "workspace-folder-required" });
        return resolved;
    }
    catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT" || code === "ENOTDIR") throw new LabloomError({ kind: "workspace-folder-missing", path, diagnostic: diagnostic(error) }, { cause: error });
        throw new LabloomError(toFailureInfo(error), { cause: error });
    }
}

export function createWorkspace(path: string): OpenWorkspace {
    const root = directoryPath(path);
    if (readdirSync(root).length !== 0) {
        throw new LabloomError({ kind: "workspace-folder-not-empty" });
    }

    const databasePath = join(root, "workspace.sqlite");
    const attachmentsPath = join(root, "attachments");
    // Reserve the database name exclusively; never overwrite an existing file.
    closeSync(openSync(databasePath, "wx"));
    let database: Database.Database | undefined;
    let createdAttachments = false;
    try {
        database = new Database(databasePath, { fileMustExist: true });
        database.pragma("foreign_keys = ON");
        const db = createWorkspaceDatabase(database);
        mkdirSync(attachmentsPath);
        createdAttachments = true;
        const info = { id: randomUUID(), name: basename(root), path: root };
        database.transaction(() => {
            database!.pragma(`application_id = ${applicationId}`);
            createWorkspaceSchema(database!);
            initializeBuiltinAttrs(db);
            validateBuiltinAttrs(db);
            const now = Date.now();
            db.insert(workspaceMeta).values({ id: info.id, name: info.name, createdAt: now, lastModifiedAt: now }).run();
            if ((database!.pragma("foreign_key_check") as unknown[]).length) {
                throw new LabloomError({ kind: "workspace-foreign-key-check" });
            }
        })();
        return { info, database, db };
    }
    catch (error) {
        database?.close();
        // Only remove files created by this attempt; never recursively delete a folder.
        unlinkSync(databasePath);
        if (createdAttachments) rmdirSync(attachmentsPath);
        throw error;
    }
}

export function openWorkspace(path: string, expectedId?: string): OpenWorkspace {
    const root = directoryPath(path);
    const databasePath = join(root, "workspace.sqlite");
    try {
        if (!statSync(databasePath).isFile()) throw new LabloomError({ kind: "workspace-not-workspace", path: root });
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new LabloomError({ kind: "workspace-not-workspace", path: root });
        throw new LabloomError(toFailureInfo(error), { cause: error });
    }
    // Reject incompatible workspaces before opening a writable connection.
    const reader = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
        validateWorkspace(reader, root, expectedId);
    }
    finally {
        reader.close();
    }
    const database = new Database(databasePath, { fileMustExist: true });
    try {
        const info = validateWorkspace(database, root, expectedId);
        const db = createWorkspaceDatabase(database);
        database.pragma("foreign_keys = ON");
        withFileCleanup(db, root, cleanup => cleanup());
        return { info, database, db };
    }
    catch (error) {
        database.close();
        throw error;
    }
}

function validateWorkspace(database: Database.Database, root: string, expectedId?: string): Workspace {
    if (database.pragma("application_id", { simple: true }) !== applicationId) {
        throw new LabloomError({ kind: "workspace-not-workspace", path: root });
    }
    validateWorkspaceSchema(database);
    const db = createWorkspaceDatabase(database);
    const rows = db.select({ id: workspaceMeta.id, name: workspaceMeta.name }).from(workspaceMeta).all();
    const row = rows[0];
    if (rows.length !== 1 || typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id)
        || typeof row.name !== "string" || row.name.length === 0) {
        throw new LabloomError({ kind: "workspace-corrupt" });
    }
    if (expectedId && row.id !== expectedId) {
        throw new LabloomError({ kind: "workspace-changed" });
    }
    try {
        if (!statSync(join(root, "attachments")).isDirectory()) throw new LabloomError({ kind: "workspace-attachments-unavailable" });
    }
    catch (error) {
        throw new LabloomError({ kind: "workspace-attachments-unavailable", diagnostic: error instanceof LabloomError ? undefined : diagnostic(error) }, { cause: error });
    }
    validateBuiltinAttrs(db);
    return { id: row.id, name: row.name, path: root };
}