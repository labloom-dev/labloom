import { LabloomError } from "../shared/failure";
import type { OpenWorkspace } from "./storage/workspace";
import { fetchFeed, type FeedRequest, type FeedResult } from "./feed/parser";

export type SessionOptions = {
    clock?: () => number;
    timeZone?: () => string;
    loadFeed?: (request: FeedRequest) => Promise<FeedResult>;
    fetchPDF?: typeof fetch;
};
export type WorkspaceState = OpenWorkspace & {
    generation: number;
    controller: AbortController;
    clock: () => number;
    timeZone: () => string;
    loadFeed: (request: FeedRequest) => Promise<FeedResult>;
    fetchPDF: typeof fetch;
};
let current: WorkspaceState | undefined;
let generation = 0;

export function initialize(workspace: OpenWorkspace, options: SessionOptions): void {
    current = {
        ...workspace, generation: ++generation, controller: new AbortController(),
        clock: options.clock ?? Date.now, timeZone: options.timeZone ?? (() => "system"),
        loadFeed: options.loadFeed ?? fetchFeed, fetchPDF: options.fetchPDF ?? fetch
    };
}
export function requireWorkspace(): WorkspaceState {
    if (!current) throw new LabloomError({ kind: "workspace-not-ready" });
    return current;
}
export function isCurrent(workspace: WorkspaceState): boolean {
    return current === workspace && !workspace.controller.signal.aborted;
}
export function release(): void {
    current?.controller.abort();
    current = undefined;
}
export function ready(): boolean {
    return current !== undefined;
}
export function database(): OpenWorkspace["db"] {
    return requireWorkspace().db;
}
export function native(): OpenWorkspace["database"] {
    return requireWorkspace().database;
}
export function root(): string {
    return requireWorkspace().info.path;
}
export function clock(): number {
    return requireWorkspace().clock();
}
export function seconds(): number {
    return Math.floor(clock() / 1000);
}
export function timeZone(): string {
    return requireWorkspace().timeZone();
}