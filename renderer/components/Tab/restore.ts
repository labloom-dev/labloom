import { record } from "../../../shared/attrs/values";
import type { TabState } from "./defs";

export function restoreTabState(state: unknown): TabState | undefined {
    if (!record(state) || !Array.isArray(state.groups) || !state.groups.length || !record(state.layout)) return;
    const groupIds = new Set<string>(), tabIds = new Set<string>();
    for (const group of state.groups) {
        if (!record(group) || typeof group.id !== "string" || groupIds.has(group.id) || !Array.isArray(group.tabs)) return;
        groupIds.add(group.id);
        for (const tab of group.tabs) {
            if (!record(tab) || typeof tab.id !== "string" || tabIds.has(tab.id) || typeof tab.title !== "string" || !["page", "overview", "library", "papers", "calendar", "feed", "settings", "about", "attributes"].includes(String(tab.type)) || (tab.type === "page" && typeof tab.pageId !== "string")) return;
            tabIds.add(tab.id);
        }
        if (group.activeTabId !== null && !group.tabs.some(tab => tab.id === group.activeTabId)) return;
    }
    if (!groupIds.has(String(state.focusedGroupId))) return;
    const pending: unknown[] = [state.layout];
    while (pending.length) {
        const node = pending.pop();
        if (!record(node)) return;
        if (node.type === "group") {
            if (!groupIds.delete(String(node.groupId))) return;
        }
        else {
            if (node.type !== "split" || !["horizontal", "vertical"].includes(String(node.direction)) || typeof node.ratio !== "number" || !(node.ratio >= 0.1 && node.ratio <= 0.9) || !Array.isArray(node.children) || node.children.length !== 2) return;
            pending.push(node.children[0], node.children[1]);
        }
    }
    return groupIds.size ? undefined : state as TabState;
}