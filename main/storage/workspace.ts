import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import type { Workspace } from "../../shared/types/startup";

const applicationId = 0x4c424c4d;
const formatVersion = 1;

export type OpenWorkspace = {
    info: Workspace;
    database: Database.Database;
};

function directoryPath(path: string): string {
    const resolved = realpathSync(path);
    if (!statSync(resolved).isDirectory()) throw new Error("请选择工作文件夹。");
    return resolved;
}

export function createWorkspace(path: string): OpenWorkspace {
    const root = directoryPath(path);
    if (readdirSync(root).length !== 0) {
        throw new Error("创建工作区需要一个空文件夹。如果这里已有工作区，请选择“打开已有工作区”。");
    }

    const databasePath = join(root, "workspace.sqlite");
    const attachmentsPath = join(root, "attachments");
    // Reserve the database name exclusively; never overwrite an existing file.
    closeSync(openSync(databasePath, "wx"));
    let database: Database.Database | undefined;
    let createdAttachments = false;
    try {
        database = new Database(databasePath, { fileMustExist: true });
        mkdirSync(attachmentsPath);
        createdAttachments = true;
        const info = { id: randomUUID(), name: basename(root), path: root };
        database.transaction(() => {
            database!.pragma(`application_id = ${applicationId}`);
            database!.pragma(`user_version = ${formatVersion}`);
            database!.exec("CREATE TABLE workspace_meta (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL)");
            database!.prepare("INSERT INTO workspace_meta (id, name, created_at) VALUES (?, ?, ?)")
                .run(info.id, info.name, new Date().toISOString());
        })();
        database.pragma("foreign_keys = ON");
        return { info, database };
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
    const database = new Database(join(root, "workspace.sqlite"), { fileMustExist: true });
    try {
        if (database.pragma("application_id", { simple: true }) !== applicationId) {
            throw new Error("这个文件夹不是有效的知织工作区。");
        }
        if (database.pragma("user_version", { simple: true }) !== formatVersion) {
            throw new Error("工作区格式与当前应用不兼容，请使用匹配版本的知织打开。");
        }
        const rows = database.prepare<[], { id: unknown; name: unknown; }>("SELECT id, name FROM workspace_meta").all();
        const row = rows[0];
        if (rows.length !== 1 || typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id)
            || typeof row.name !== "string" || row.name.length === 0) {
            throw new Error("工作区信息损坏，无法打开。");
        }
        if (expectedId && row.id !== expectedId) {
            throw new Error("这个位置的工作区已经改变，请通过“打开已有工作区”重新选择。");
        }
        if (!statSync(join(root, "attachments")).isDirectory()) {
            throw new Error("工作区的附件文件夹不可用。");
        }
        database.pragma("foreign_keys = ON");
        return { info: { id: row.id, name: row.name, path: root }, database };
    }
    catch (error) {
        database.close();
        throw error;
    }
}