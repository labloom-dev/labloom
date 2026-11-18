import type { CommitResult } from "../types/content";
import type { HistoryState } from "../types/knowledge";
import type { TabId, Channels } from "../ipc/contract";

export type HistoryAPI = {
    state(tabId: TabId): Promise<HistoryState>;
    apply(tabId: TabId, direction: "undo" | "redo", branchId?: string, confirmation?: string): Promise<CommitResult>;
    closeTab(tabId: TabId): Promise<void>;
};

export const historyChannels = {
    state: "history:state",
    apply: "history:apply",
    closeTab: "history:close-tab"
} as const satisfies Channels<HistoryAPI>;