import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import Database from "better-sqlite3";
import { openWorkspace } from "../storage/workspace";
import { identifier, object, text } from "./document";

type BackupManifest = { format: "labloom-backup"; version: 1; createdAt: string; name: string; files: { path: string; size: number; sha256: string }[] };

function contained(root: string, path: string): boolean {
    const rel = relative(root, path);
    return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

function hash(path: string): string {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function files(root: string, directory = "attachments"): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new Error(`附件包含符号链接，无法保证备份完整：${path}`);
        if (entry.isDirectory()) result.push(...files(root, path));
        else if (entry.isFile()) result.push(path);
        else throw new Error(`附件类型不受支持：${path}`);
        if (result.length > 100000) throw new Error("附件数量超过备份限制。");
    }
    return result;
}

export function createBackup(database: Database.Database, workspace: string, parent: string): string {
    workspace = realpathSync(workspace);
    parent = realpathSync(parent);
    if (contained(workspace, parent)) throw new Error("请将备份保存在工作区以外的文件夹。");
    const name = `Labloom-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const target = join(parent, name);
    const partial = `${target}.partial`;
    mkdirSync(partial);
    try {
        // This synchronous snapshot/copy cannot interleave with main-process mutations.
        database.prepare("VACUUM INTO ?").run(join(partial, "workspace.sqlite"));
        mkdirSync(join(partial, "attachments"));
        const entries = ["workspace.sqlite", ...files(workspace)];
        for (const file of entries.slice(1)) {
            mkdirSync(dirname(join(partial, file)), { recursive: true });
            copyFileSync(join(workspace, file), join(partial, file));
        }
        const manifest: BackupManifest = {
            format: "labloom-backup", version: 1, createdAt: new Date().toISOString(),
            name: database.prepare<[], { name: string }>("SELECT name FROM workspace_meta").get()!.name,
            files: entries.map(path => ({ path, size: statSync(join(partial, path)).size, sha256: hash(join(partial, path)) }))
        };
        writeFileSync(join(partial, "manifest.json"), JSON.stringify(manifest, null, 4), { flag: "wx" });
        verifyBackup(partial);
        renameSync(partial, target);
        return target;
    }
    catch (error) {
        rmSync(partial, { recursive: true, force: true });
        throw error;
    }
}

export function verifyBackup(root: string): BackupManifest {
    root = realpathSync(root);
    const manifestPath = join(root, "manifest.json");
    if (lstatSync(manifestPath).isSymbolicLink() || statSync(manifestPath).size > 16 * 1024 * 1024) throw new Error("备份清单无效。");
    const value = object(JSON.parse(readFileSync(manifestPath, "utf8")));
    if (value.format !== "labloom-backup" || value.version !== 1 || !Array.isArray(value.files) || value.files.length > 100000) throw new Error("备份格式不受支持。");
    text(value.name, 500, false);
    text(value.createdAt, 100, false);
    const seen = new Set<string>();
    for (const input of value.files) {
        const file = object(input);
        const path = text(file.path, 4096, false);
        if ((path !== "workspace.sqlite" && !path.startsWith("attachments/")) || path.split("/").some(part => !part || part === "." || part === "..") || path.includes("\\") || path.includes(":")) throw new Error("备份包含不安全的文件路径。");
        if (seen.has(path)) throw new Error("备份清单包含重复文件。");
        seen.add(path);
        const absolute = join(root, path);
        if (!contained(root, realpathSync(absolute)) || lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()
            || statSync(absolute).size !== file.size || hash(absolute) !== file.sha256) throw new Error(`备份文件缺失或校验失败：${path}`);
    }
    if (!seen.has("workspace.sqlite")) throw new Error("备份缺少工作区数据库。");
    const database = new Database(join(root, "workspace.sqlite"), { readonly: true, fileMustExist: true });
    try {
        const integrity = database.pragma("quick_check") as { quick_check: string }[];
        if (integrity.length !== 1 || integrity[0].quick_check !== "ok" || (database.pragma("foreign_key_check") as unknown[]).length) throw new Error("备份数据库或关联关系校验失败。");
        if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'attachments'").get()) {
            for (const attachment of database.prepare<[], { id: string; size: number; hash: string }>("SELECT id, size, hash FROM attachments").all()) {
                const file = `attachments/${identifier(attachment.id)}.pdf`;
                if (!seen.has(file) || statSync(join(root, file)).size !== attachment.size || hash(join(root, file)) !== attachment.hash) throw new Error(`备份缺少有效的文献附件：${file}`);
            }
        }
    }
    finally { database.close(); }
    return value as unknown as BackupManifest;
}

export function restoreBackup(backup: string, destination: string): string {
    const manifest = verifyBackup(backup);
    backup = realpathSync(backup);
    destination = realpathSync(destination);
    if (contained(backup, destination) || contained(destination, backup) || readdirSync(destination).length) throw new Error("请选择备份文件夹以外的空文件夹。");
    const stage = `${destination}.labloom-restore-${randomUUID()}`;
    mkdirSync(stage);
    let removedEmptyFolder = false;
    try {
        mkdirSync(join(stage, "attachments"));
        for (const file of manifest.files) {
            mkdirSync(dirname(join(stage, file.path)), { recursive: true });
            copyFileSync(join(backup, file.path), join(stage, file.path));
            if (hash(join(stage, file.path)) !== file.sha256) throw new Error(`恢复时校验失败：${file.path}`);
        }
        const workspace = openWorkspace(stage);
        try {
            const checks = workspace.database.pragma("integrity_check") as { integrity_check: string }[];
            if (checks.length !== 1 || checks[0].integrity_check !== "ok" || (workspace.database.pragma("foreign_key_check") as unknown[]).length) throw new Error("备份数据库或关联关系校验失败。");
        }
        finally { workspace.database.close(); }
        // The destination is an explicitly selected empty folder; never replace data.
        rmdirSync(destination);
        removedEmptyFolder = true;
        renameSync(stage, destination);
        return destination;
    }
    catch (error) {
        rmSync(stage, { recursive: true, force: true });
        if (removedEmptyFolder) mkdirSync(destination, { recursive: true });
        throw error;
    }
}

export function workspaceBytes(root: string): number {
    return ["workspace.sqlite", ...files(root)].reduce((sum, path) => sum + statSync(join(root, path)).size, 0);
}