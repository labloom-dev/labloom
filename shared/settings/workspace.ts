import { LabloomError } from "../failure";
export type RecentPage = { id: string; openedAt: number };
export type WorkspaceNavigation = { expandedGroups: string[]; recentPages: RecentPage[] };
export const defaultExpandedGroups = ["pinned", "independent"];
export const recentPageLimit = 50;
export type WorkspaceSettings = { tabs: unknown | null; feedKeywords: string[] } & Partial<WorkspaceNavigation>;
export type WorkspaceSettingsPatch = Partial<WorkspaceSettings>;
export function normalizeKeywords(value: unknown): string[] {
    if (!Array.isArray(value) || value.some(word => typeof word !== "string")) throw new LabloomError({ kind: "feed-invalid-keywords" });
    const unique = new Map<string, string>();
    for (const word of value as string[]) {
        const text = word.trim().replace(/\s+/g, " ");
        if (text && !unique.has(text.toLowerCase())) unique.set(text.toLowerCase(), text);
    }
    return [...unique.values()];
}