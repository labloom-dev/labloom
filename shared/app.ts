import type { FeedAPI } from "./types/feed";
import { type Appearance } from "./types/appearance";
import type { StartupState, WorkspaceAction } from "./types/startup";
import { type KnowledgeAPI } from "./types/knowledge";

// The only surface the renderer can reach; preload implements it over IPC.
export type AppAPI = {
    openDevTools(): void;
    appearance: {
        get(): Promise<Appearance>;
        save(value: Appearance): Promise<Appearance>;
        onChanged(listener: (value: Appearance) => void): () => void;
    };
    feed: FeedAPI;
    knowledge: KnowledgeAPI;
    startup: {
        getState(): Promise<StartupState>;
        chooseWorkspace(action: WorkspaceAction): Promise<StartupState>;
        retry(): Promise<StartupState>;
    };
};