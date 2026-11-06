import type { LayoutNode, TabState } from "./defs";
import { tabState } from "./state.svelte";

export async function restoreTabs(): Promise<void> {
    const value = await window.api.knowledge.getSetting("tabs") as TabState | null;
    if (!value || !Array.isArray(value.groups) || !value.groups.length || value.groups.length > 16) return;
    const ids = new Set<string>(), tabs = new Set<string>();
    const types = new Set(["page", "overview", "about", "settings", "feed", "reader-test", "knowledge", "calendar", "assistant"]);
    for (const group of value.groups) {
        if (!group || typeof group.id !== "string" || !group.id.startsWith("group-") || ids.has(group.id) || !Array.isArray(group.tabs) || group.tabs.length > 100) return;
        ids.add(group.id);
        for (const tab of group.tabs) {
            if (!tab || typeof tab.id !== "string" || !tab.id.startsWith("tab-") || tabs.has(tab.id) || typeof tab.title !== "string" || !types.has(tab.type) || (tab.type === "page" && typeof tab.pageId !== "string")) return;
            tabs.add(tab.id);
        }
        if (group.activeTabId !== null && !group.tabs.some(tab => tab.id === group.activeTabId)) return;
    }
    if (!ids.has(value.focusedGroupId)) return;
    const leaves = new Set<string>();
    function valid(node: LayoutNode, depth = 0): boolean {
        if (!node || depth > 16) return false;
        if (node.type === "group") { if (!ids.has(node.groupId) || leaves.has(node.groupId)) return false; leaves.add(node.groupId); return true; }
        return node.type === "split" && ["horizontal", "vertical"].includes(node.direction) && node.ratio >= 0.1 && node.ratio <= 0.9 && Array.isArray(node.children) && node.children.length === 2 && node.children.every(child => valid(child, depth + 1));
    }
    if (!valid(value.layout) || leaves.size !== ids.size) return;
    Object.assign(tabState, value);
}