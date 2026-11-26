import { type WorkspaceAction, type Workspace } from "../shared/types/startup";
import * as settings from "./settings/store";
import * as workspaceSettings from "./workspace-settings";
import { createWorkspace, openWorkspace, closeWorkspace, type OpenWorkspace } from "./storage/workspace";
import { fetchFeed } from "./feed/parser";
import * as state from "./workspace-state";
import * as records from "./knowledge/records";
import * as query from "./knowledge/query";
import * as history from "./knowledge/history-state";
import * as attachments from "./attachments/service";
import * as papers from "./knowledge/papers";
import * as feed from "./feed/service";
import * as timers from "./knowledge/timers";
import * as commit from "./knowledge/commit";
import * as scheduler from "./knowledge/scheduler";
export { type SessionOptions } from "./workspace-state";
export { database as getDatabase, native as getNative, root as getPath, ready } from "./workspace-state";
let network: typeof fetch = fetch;

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
            clock: Date.now, timeZone: () => settings.get().settings.appearance.timeZone,
            loadFeed: request => fetchFeed(request, network), fetchAttachment: network, ...options
        });
        attachments.recoverDownloads();
        records.initialize();
        workspaceSettings.initialize();
        commit.run({ history: false, cleanup: true }, context => {
            const blocks = context.cleanup();
            context.change({ blocks, purged: [] });
        });
        scheduler.start();
        return workspace;
    }
    catch (error) {
        try {
            close();
        }
        finally {
            closeWorkspace(workspace, true);
        }
        throw error;
    }
}
export function close(): void {
    const workspace = state.ready() ? state.requireWorkspace() : undefined;
    scheduler.stop();
    state.release();
    feed.release();
    timers.release();
    papers.release();
    attachments.release();
    commit.release();
    history.release();
    workspaceSettings.release();
    query.release();
    records.release();
    if (workspace) closeWorkspace(workspace);
}