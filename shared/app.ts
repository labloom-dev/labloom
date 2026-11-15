import type { FeedAPI } from "./types/feed";
import { type SettingsSnapshot, type SettingsResult, type SettingsPatch } from "./settings/Settings";
import type { StartupState, WorkspaceAction } from "./types/startup";
import { type KnowledgeAPI } from "./types/knowledge";

// The only surface the renderer can reach; preload implements it over IPC.
export type AppAPI = {
    openDevTools(): void;
    beforeQuit(check: () => Promise<boolean> | boolean): () => void;
    settings: {
        get(): Promise<SettingsSnapshot>;
        update(patch: SettingsPatch): Promise<SettingsResult>;
        flush(revision: number): Promise<SettingsResult>;
        onChanged(listener: (snapshot: SettingsSnapshot) => void): () => void;
    };
    feed: FeedAPI;
    knowledge: KnowledgeAPI;
    startup: {
        getState(): Promise<StartupState>;
        chooseWorkspace(action: WorkspaceAction): Promise<StartupState>;
        retry(): Promise<StartupState>;
    };
};