import { LabloomError } from "../../shared/failure";
import type { StartupState, WorkspaceAction } from "../../shared/types/startup";
import { AppStorage } from "../storage/app";
import { createWorkspace, openWorkspace, type OpenWorkspace } from "../storage/workspace";
import { diagnostic, toFailureInfo } from "../../shared/failure";
import { setLocale } from "../ui/i18n";

export class Startup {
    onReady?: () => void;
    state: StartupState = { status: "needs-workspace", lastWorkspace: null, canChoose: false };
    private workspace: OpenWorkspace | null = null;

    constructor(private readonly storage: AppStorage) {}

    restore(): StartupState {
        if (this.state.status === "ready") return this.state;
        this.state = { status: "needs-workspace", lastWorkspace: null, canChoose: false };
        try {
            const config = this.storage.load();
            setLocale(this.storage.getAppearance().language);
            this.state = { status: "needs-workspace", canChoose: true, ...config };
            if (config.lastWorkspace) {
                this.workspace = openWorkspace(config.lastWorkspace.path, config.lastWorkspace.id);
                this.state = { status: "ready", workspace: this.workspace.info };
                this.onReady?.();
            }
        }
        catch (error) {
            if (this.state.status === "needs-workspace") {
                console.error("Workspace restore failed", error);
                this.state = { ...this.state, attemptedPath: this.state.lastWorkspace?.path, error: toFailureInfo(error) };
            }
        }
        return this.state;
    }

    choose(path: string, action: WorkspaceAction): StartupState {
        // Switching an open workspace requires an editor save lifecycle, added later.
        if (this.state.status === "ready" || !this.state.canChoose) return this.state;
        const { error: previousError, ...previous } = this.state;
        let workspace: OpenWorkspace | undefined;
        try {
            workspace = action === "create" ? createWorkspace(path) : openWorkspace(path);
            this.storage.remember(workspace.info);
            this.workspace = workspace;
            this.state = { status: "ready", workspace: workspace.info };
            this.onReady?.();
        }
        catch (error) {
            workspace?.database.close();
            console.error("Workspace selection failed", error);
            this.state = { ...previous, attemptedPath: path, error: workspace && action === "create" ? { kind: "workspace-created-config-failed", diagnostic: diagnostic(error) } : toFailureInfo(error) };
        }
        return this.state;
    }

    close(): void {
        this.workspace?.database.close();
        this.workspace = null;
    }

    getDatabase(): OpenWorkspace["db"] {
        if (!this.workspace || this.state.status !== "ready") throw new LabloomError({ kind: "workspace-not-ready" });
        return this.workspace.db;
    }

    getPath(): string {
        if (!this.workspace) throw new LabloomError({ kind: "workspace-not-ready" });
        return this.workspace.info.path;
    }
}