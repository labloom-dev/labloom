import { LabloomError } from "../failure";
export type WorkspaceSettings = { tabs: unknown | null; feedKeywords: string[] };
export type WorkspaceSettingsPatch = Partial<WorkspaceSettings>;
export function validateTabs(value: unknown): void {
    const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
    if (!record(value) || JSON.stringify(value).length > 1000000 || !Array.isArray(value.groups) || value.groups.length > 32 || !record(value.layout) || typeof value.focusedGroupId !== "string") throw new LabloomError({ kind: "tabs-invalid-layout" });
}
export function normalizeKeywords(value: unknown): string[] {
    if (!Array.isArray(value) || value.some(word => typeof word !== "string")) throw new LabloomError({ kind: "feed-invalid-keywords" });
    const unique = new Map<string, string>();
    for (const word of value as string[]) {
        const text = word.trim().replace(/\s+/g, " ");
        if (text.length > 100) throw new LabloomError({ kind: "feed-keyword-too-long" });
        if (text && !unique.has(text.toLowerCase())) unique.set(text.toLowerCase(), text);
    }
    if (unique.size > 50) throw new LabloomError({ kind: "feed-too-many-keywords" });
    return [...unique.values()];
}