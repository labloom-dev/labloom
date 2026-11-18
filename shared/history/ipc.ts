import type { CommitResult } from "../types/content";
import type { HistoryState } from "../types/knowledge";
import type { Channels, TabId } from "../ipc/contract";

export type HistorySource = { kind: "page"; id: string } | { kind: "workspace" };
export type HistoryOrigin = { tabId: TabId; source: HistorySource };
export type HistoryAPI = {
    state(source: HistorySource): Promise<HistoryState>;
    apply(source: HistorySource, direction: "undo" | "redo", branchId?: string, confirmation?: string): Promise<CommitResult>;
    onChanged(listener: (sources: HistorySource[]) => void): () => void;
};

export const historyChannels = {
    state: "history:state",
    apply: "history:apply"
} as const satisfies Channels<HistoryAPI>;
export const historyChanged = "history:changed";