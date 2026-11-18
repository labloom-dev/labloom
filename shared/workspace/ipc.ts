import type { SavedTabs } from "../workspace/tabs";
import type { Channels } from "../ipc/contract";

export type WorkspaceAPI = {
    loadTabs(): Promise<unknown>;
    saveTabs(value: SavedTabs): Promise<void>;
};

export const workspaceChannels = {
    loadTabs: "workspace:load-tabs",
    saveTabs: "workspace:save-tabs"
} as const satisfies Channels<WorkspaceAPI>;