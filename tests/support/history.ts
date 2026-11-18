import type { HistorySource } from "../../shared/history/ipc";

export const workspaceHistory = { kind: "workspace" } as const;
export const pageHistory = (id: string): HistorySource => ({ kind: "page", id });