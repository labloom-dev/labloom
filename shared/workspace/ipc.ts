import type { SavedTabs } from "../workspace/tabs";
import { type WorkspaceNavigation } from "../settings/workspace";
import type { Channels } from "../ipc/contract";

export type WorkspaceAPI = {
    loadTabs(): Promise<unknown>;
    loadNavigation(): Promise<WorkspaceNavigation>;
    saveTabs(value: SavedTabs, navigation?: WorkspaceNavigation): Promise<void>;
};

export const workspaceChannels = {
    loadTabs: "workspace:load-tabs",
    loadNavigation: "workspace:load-navigation",
    saveTabs: "workspace:save-tabs"
} as const satisfies Channels<WorkspaceAPI>;