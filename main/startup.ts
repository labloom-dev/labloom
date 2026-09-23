import type { StartupState, WorkspaceAction } from "../shared/types/startup";
import { AppStorage } from "./storage/app";
import { createWorkspace, openWorkspace, type OpenWorkspace } from "./storage/workspace";

function errorMessage(error: unknown): string {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "SQLITE_CANTOPEN") {
        return "工作区或所需文件不存在、无法访问。请检查文件夹位置后重试，或打开其他工作区。";
    }
    if (code === "EACCES" || code === "EPERM" || code === "SQLITE_READONLY") {
        return "没有读写这个位置的权限，请检查文件夹权限后重试。";
    }
    if (code === "SQLITE_NOTADB" || code === "SQLITE_CORRUPT") return "工作区数据库损坏或格式无效，无法打开。";
    if (code === "ENOSPC" || code === "SQLITE_FULL") return "磁盘空间不足，请释放空间后重试。";
    return error instanceof Error ? error.message : "打开工作区失败，请重试。";
}

export class Startup {
    state: StartupState = { status: "needs-workspace", lastWorkspace: null, canChoose: false };
    private workspace: OpenWorkspace | null = null;

    constructor(private readonly storage: AppStorage) {}

    restore(): StartupState {
        if (this.state.status === "ready") return this.state;
        this.state = { status: "needs-workspace", lastWorkspace: null, canChoose: false };
        try {
            const config = this.storage.load();
            this.state = { status: "needs-workspace", canChoose: true, ...config };
            if (config.lastWorkspace) {
                this.workspace = openWorkspace(config.lastWorkspace.path, config.lastWorkspace.id);
                this.state = { status: "ready", workspace: this.workspace.info };
            }
        }
        catch (error) {
            if (this.state.status === "needs-workspace") {
                this.state = { ...this.state, error: errorMessage(error) };
            }
        }
        return this.state;
    }

    choose(path: string, action: WorkspaceAction): StartupState {
        // Switching an open workspace requires an editor save lifecycle, added later.
        if (this.state.status === "ready" || !this.state.canChoose) return this.state;
        const previous = this.state;
        let workspace: OpenWorkspace | undefined;
        try {
            workspace = action === "create" ? createWorkspace(path) : openWorkspace(path);
            this.storage.remember(workspace.info);
            this.workspace = workspace;
            this.state = { status: "ready", workspace: workspace.info };
        }
        catch (error) {
            workspace?.database.close();
            const prefix = workspace && action === "create" ? "工作区已创建，但应用配置保存失败。请用“打开已有工作区”重试。\n" : "";
            this.state = { ...previous, error: prefix + errorMessage(error) };
        }
        return this.state;
    }

    close(): void {
        this.workspace?.database.close();
        this.workspace = null;
    }
}