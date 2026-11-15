import { diagnostic, toFailureInfo } from "../../shared/failure";
import { type StartupState, type WorkspaceAction } from "../../shared/types/startup";
import { type AppStorage } from "../storage/app";
import { setLocale } from "../ui/i18n";
import * as session from "../session";

export let state: StartupState = { status: "needs-workspace", lastWorkspace: null, canChoose: false };
let storage: AppStorage;
export function initialize(value: AppStorage): void {
    storage = value;
    session.configureStorage(value);
    state = { status: "needs-workspace", lastWorkspace: null, canChoose: false };
}
export function restore(): StartupState {
    if (state.status === "ready") return state;
    state = { status: "needs-workspace", lastWorkspace: null, canChoose: false };
    try {
        const config = storage.load();
        setLocale(storage.getAppearance().language);
        state = { status: "needs-workspace", canChoose: true, ...config };
        if (config.lastWorkspace) {
            const workspace = session.open(config.lastWorkspace.path, "open", undefined, config.lastWorkspace.id);
            state = { status: "ready", workspace: workspace.info };
        }
    }
    catch (error) {
        if (state.status === "needs-workspace") {
            console.error("Workspace restore failed", error);
            state = { ...state, attemptedPath: state.lastWorkspace?.path, error: toFailureInfo(error) };
        }
    }
    return state;
}
export function choose(path: string, action: WorkspaceAction): StartupState {
    // Workspace switching still needs the editor-save lifecycle from the next round.
    if (state.status === "ready" || !state.canChoose) return state;
    const { error: previousError, ...previous } = state;
    let created = false;
    try {
        const workspace = session.open(path, action);
        created = true;
        storage.remember(workspace.info);
        state = { status: "ready", workspace: workspace.info };
    }
    catch (error) {
        session.close();
        console.error("Workspace selection failed", error);
        state = { ...previous, attemptedPath: path, error: created && action === "create" ? { kind: "workspace-created-config-failed", diagnostic: diagnostic(error) } : toFailureInfo(error) };
    }
    return state;
}
export function close(): void {
    session.close();
    state = { status: "needs-workspace", lastWorkspace: null, canChoose: false };
}