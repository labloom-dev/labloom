import { type WorkspaceAction, type Workspace } from "../shared/types/startup";
import { type AppStorage } from "./storage/app";
import { createWorkspace, openWorkspace, type OpenWorkspace } from "./storage/workspace";
import { fetchFeed } from "./feed/parser";
import * as state from "./workspace-state";
import * as records from "./knowledge/records";
import * as history from "./knowledge/history-state";
import * as papers from "./knowledge/papers";
import * as feed from "./feed/service";
import * as timers from "./knowledge/timers";
import * as commit from "./knowledge/commit";
import * as scheduler from "./knowledge/scheduler";
export { type SessionOptions } from "./workspace-state";
export { database as getDatabase, native as getNative, root as getPath, ready } from "./workspace-state";
let storage: AppStorage | undefined;
let network: typeof fetch = fetch;

export function configureStorage(value: AppStorage): void {
    storage = value;
}
export function configureNetwork(value: typeof fetch): void {
    network = value;
}
export function getInfo(): Workspace {
    return state.requireWorkspace().info;
}
export function open(path: string, action: WorkspaceAction, options: state.SessionOptions = {}, expectedId?: string): OpenWorkspace {
    close();
    const workspace = action === "create" ? createWorkspace(path) : openWorkspace(path, expectedId);
    try {
        state.initialize(workspace, {
            clock: Date.now, timeZone: () => storage?.getAppearance().timeZone ?? "system",
            loadFeed: request => fetchFeed(request, network), fetchPDF: network, ...options
        });
        records.initialize();
        commit.run({ sourceTab: "", history: false, cleanup: true }, context => {
            const blocks = context.cleanup();
            context.change({ blocks, purged: [] });
        });
        scheduler.start();
        return workspace;
    }
    catch (error) {
        close();
        if (workspace.database.open) workspace.database.close();
        throw error;
    }
}
export function close(): void {
    const database = state.ready() ? state.native() : undefined;
    scheduler.stop();
    state.release();
    feed.release();
    timers.release();
    papers.release();
    commit.release();
    history.release();
    records.release();
    if (database?.open) database.close();
}