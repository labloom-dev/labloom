import type { WorkspaceAction, StartupState } from "../types/startup";
import type { Channels } from "../ipc/contract";

export type StartupAPI = {
    getState(): Promise<StartupState>;
    retry(): Promise<StartupState>;
    chooseWorkspace(action: WorkspaceAction): Promise<StartupState>;
};

export const startupChannels = {
    getState: "startup:get-state",
    retry: "startup:retry",
    chooseWorkspace: "startup:choose-workspace"
} as const satisfies Channels<StartupAPI>;