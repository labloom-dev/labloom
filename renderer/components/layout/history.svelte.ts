import type { Tab } from "../Tab/defs";
import { activateTab, addTab, getTabID } from "../Tab/api";
import { tabState } from "../Tab/state.svelte";

export const navigationHistory = $state({ entries: [] as Tab[], index: -1 });
const key = (tab: Tab): string => tab.type === "page" ? tab.pageId : tab.type;
let navigating = false;

export function recordVisit(tab: Tab): void {
    if (navigating) { navigating = false; return; }
    if (navigationHistory.entries[navigationHistory.index] && key(navigationHistory.entries[navigationHistory.index]) === key(tab)) return;
    navigationHistory.entries.splice(navigationHistory.index + 1);
    navigationHistory.entries.push({ ...tab });
    if (navigationHistory.entries.length > 100) navigationHistory.entries.shift();
    navigationHistory.index = navigationHistory.entries.length - 1;
}

export function navigateHistory(direction: -1 | 1): void {
    const index = navigationHistory.index + direction;
    const tab = navigationHistory.entries[index];
    if (!tab) return;
    navigating = true;
    navigationHistory.index = index;
    const existing = tabState.groups.flatMap(group => group.tabs).find(item => key(item) === key(tab));
    if (existing) activateTab(existing.id);
    else addTab(tabState.focusedGroupId, { ...tab, id: getTabID() });
}