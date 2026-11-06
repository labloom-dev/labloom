import type { StartupState, WorkspaceAction } from "../../shared/types/startup";
import { AppStorage } from "../storage/app";
import { createWorkspace, openWorkspace, type OpenWorkspace } from "../storage/workspace";
import { WorkspaceUpgradeError } from "../storage/upgrade";

function errorMessage(error: unknown): string {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "SQLITE_CANTOPEN") {
        return "The workspace or a required file is missing or inaccessible. Check its location and try again, or open another workspace.";
    }
    if (code === "EACCES" || code === "EPERM" || code === "SQLITE_READONLY") {
        return "You do not have permission to read or write to this location. Check its permissions and try again.";
    }
    if (code === "SQLITE_NOTADB" || code === "SQLITE_CORRUPT") return "The workspace database is corrupted or invalid and cannot be opened.";
    if (code === "ENOSPC" || code === "SQLITE_FULL") return "Insufficient disk space. Free up some space and try again.";
    return error instanceof Error ? error.message : "Unable to open the workspace. Try again.";
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
                this.state = error instanceof WorkspaceUpgradeError
                    ? { ...this.state, upgradeFailure: error.failure }
                    : { ...this.state, error: errorMessage(error) };
            }
        }
        return this.state;
    }

    choose(path: string, action: WorkspaceAction): StartupState {
        // Switching an open workspace requires an editor save lifecycle, added later.
        if (this.state.status === "ready" || !this.state.canChoose) return this.state;
        const { error: previousError, upgradeFailure: previousFailure, ...previous } = this.state;
        let workspace: OpenWorkspace | undefined;
        try {
            workspace = action === "create" ? createWorkspace(path) : openWorkspace(path);
            this.storage.remember(workspace.info);
            this.workspace = workspace;
            this.state = { status: "ready", workspace: workspace.info };
        }
        catch (error) {
            workspace?.database.close();
            const prefix = workspace && action === "create" ? "Workspace created, but the configuration could not be saved. Open the existing workspace to try again.\n" : "";
            this.state = error instanceof WorkspaceUpgradeError
                ? { ...previous, upgradeFailure: error.failure }
                : { ...previous, error: prefix + errorMessage(error) };
        }
        return this.state;
    }

    close(): void {
        this.workspace?.database.close();
        this.workspace = null;
    }

    getDatabase(): OpenWorkspace["database"] {
        if (!this.workspace || this.state.status !== "ready") throw new Error("请先打开工作区。");
        return this.workspace.database;
    }
}