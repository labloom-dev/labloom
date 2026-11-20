import { LabloomError } from "../shared/failure";
import { defaultExpandedGroups, recentPageLimit, normalizeKeywords, type RecentPage, type WorkspaceNavigation, type WorkspaceSettings, type WorkspaceSettingsPatch } from "../shared/settings/workspace";
import * as workspace from "./workspace-state";
import * as data from "./knowledge/records";
import * as commit from "./knowledge/commit";
import { record, validUUID } from "../shared/attrs/values";
import type { SavedTabs } from "../shared/workspace/tabs";

function checkStoredLayout(value: unknown): void {
    if (!record(value) || !Array.isArray(value.groups) || !record(value.layout) || typeof value.focusedGroupId !== "string") throw new LabloomError({ kind: "tabs-invalid-layout" });
}
let settings: WorkspaceSettings | undefined;

function recentPages(value: unknown): RecentPage[] {
    if (!Array.isArray(value)) return [];
    const latest = new Map<string, number>();
    for (const entry of value) {
        if (record(entry) && validUUID(entry.id) && typeof entry.openedAt === "number" && Number.isSafeInteger(entry.openedAt) && entry.openedAt >= 0 && Number.isFinite(new Date(entry.openedAt).getTime())) {
            latest.set(entry.id, Math.max(entry.openedAt, latest.get(entry.id) ?? 0));
        }
    }
    return [...latest].sort((a, b) => b[1] - a[1]).slice(0, recentPageLimit).map(([id, openedAt]) => ({ id, openedAt }));
}

function decode(value: unknown): WorkspaceSettings {
    const result: WorkspaceSettings = { tabs: null, feedKeywords: [] };
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        console.warn("Invalid workspace settings; using defaults");
        return result;
    }
    const input = value as Record<string, unknown>;
    if (input.tabs !== undefined && input.tabs !== null) {
        try {
            checkStoredLayout(input.tabs); result.tabs = input.tabs;
        }
        catch (error) {
            console.warn("Invalid workspace tab layout; using defaults", error);
        }
    }
    if (Array.isArray(input.expandedGroups) && input.expandedGroups.every(key => typeof key === "string")) result.expandedGroups = [...new Set<string>(input.expandedGroups)];
    if (input.recentPages !== undefined) result.recentPages = recentPages(input.recentPages);
    const keywords = input.feedKeywords;
    if (keywords !== undefined) {
        try {
            result.feedKeywords = normalizeKeywords(keywords);
        }
        catch (error) {
            console.warn("Invalid workspace feed keywords; using defaults", error);
        }
    }
    return result;
}
function read(): WorkspaceSettings {
    const text = data.statement("SELECT settings FROM workspace_meta").pluck().get() as string;
    try {
        return decode(JSON.parse(text));
    }
    catch (error) {
        console.warn("Invalid workspace settings JSON; using defaults", error); return { tabs: null, feedKeywords: [] };
    }
}
export function initialize(): void {
    workspace.requireWorkspace();
    settings = read();
}
export function release(): void {
    settings = undefined;
}
export function get(): WorkspaceSettings {
    workspace.requireWorkspace();
    if (!settings) throw new LabloomError({ kind: "workspace-not-ready" });
    return structuredClone(settings);
}
export function update(patch: WorkspaceSettingsPatch): WorkspaceSettings {
    workspace.requireWorkspace();
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(key => !["tabs", "feedKeywords", "expandedGroups", "recentPages"].includes(key))) throw new LabloomError({ kind: "invalid-argument" });
    if (Object.hasOwn(patch, "tabs") && patch.tabs !== null) checkStoredLayout(patch.tabs);
    const keywords = Object.hasOwn(patch, "feedKeywords") ? normalizeKeywords(patch.feedKeywords) : undefined;
    return commit.run({ history: false, updateModified: false, feed: keywords !== undefined }, context => {
        const next: WorkspaceSettings = { ...read(), ...structuredClone(patch), ...(keywords ? { feedKeywords: keywords } : {}) };
        data.statement("UPDATE workspace_meta SET settings=?").run(JSON.stringify(next));
        context.after(() => {
            settings = next;
        });
        return structuredClone(next);
    });
}
export function loadTabs(): unknown {
    return get().tabs;
}
export function loadNavigation(): WorkspaceNavigation {
    const { expandedGroups = [...defaultExpandedGroups], recentPages = [] } = get();
    return { expandedGroups, recentPages };
}
export function saveTabs(value: SavedTabs, navigation?: WorkspaceNavigation): void {
    workspace.requireWorkspace();
    update(navigation ? { tabs: value, expandedGroups: [...new Set(navigation.expandedGroups)], recentPages: recentPages(navigation.recentPages) } : { tabs: value });
}