import { record } from "../../../shared/attrs/values";
import { tabState } from "./state.svelte";
import { type TabState } from "./defs";

export async function restoreTabs(): Promise<void> {
    const state = await window.api.knowledge.loadTabs();
    if (!record(state) || !Array.isArray(state.groups) || !state.groups.length || !record(state.layout)) return;
    const groupIds: string[] = [], tabIds: string[] = [];
    for (const group of state.groups) {
        if (!record(group) || typeof group.id !== "string" || groupIds.includes(group.id) || !Array.isArray(group.tabs)) return;
        groupIds.push(group.id);
        for (const tab of group.tabs) {
            if (record(tab) && tab.type === "reader-test") continue;
            if (!record(tab) || typeof tab.id !== "string" || tabIds.includes(tab.id) || typeof tab.title !== "string" || !["page", "overview", "library", "papers", "calendar", "feed", "settings", "about", "attributes"].includes(String(tab.type)) || (tab.type === "page" && typeof tab.pageId !== "string")) return;
            tabIds.push(tab.id);
        }
        const removedActive = group.tabs.some(tab => record(tab) && tab.type === "reader-test" && tab.id === group.activeTabId);
        group.tabs = group.tabs.filter(tab => !record(tab) || tab.type !== "reader-test");
        if (removedActive) group.activeTabId = group.tabs[0]?.id ?? null;
        if (group.activeTabId !== null && !group.tabs.some(tab => tab.id === group.activeTabId)) return;
    }
    const leaves: string[] = [];
    function validLayout(node: unknown, depth = 0): boolean {
        if (!record(node) || depth > 32) return false;
        if (node.type === "group") {
            leaves.push(String(node.groupId));
            return groupIds.includes(String(node.groupId));
        }
        return node.type === "split" && ["horizontal", "vertical"].includes(String(node.direction)) && typeof node.ratio === "number" && node.ratio >= 0.1 && node.ratio <= 0.9 && Array.isArray(node.children) && node.children.length === 2 && node.children.every(child => validLayout(child, depth + 1));
    }
    if (!validLayout(state.layout) || leaves.some((id, index) => leaves.indexOf(id) !== index) || leaves.length !== groupIds.length || !groupIds.includes(String(state.focusedGroupId))) return;
    Object.assign(tabState, state as TabState);
}
export function persistTabs(): Promise<void> {
    return window.api.knowledge.saveTabs($state.snapshot(tabState));
}