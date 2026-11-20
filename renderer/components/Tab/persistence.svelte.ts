import { copyData } from "../copy-data";
import { destinationViews } from "../layout/navigation";
import { getTabID, getGroupID } from "./ids";
import { tabState } from "./state.svelte";
import { restoreTabState } from "./restore";

import { defaultExpandedGroups, recentPageLimit, type WorkspaceNavigation } from "../../../shared/settings/workspace";

export const navigationState = $state<WorkspaceNavigation>({ expandedGroups: [...defaultExpandedGroups], recentPages: [] });

export function recordOpen(id: string): void {
    navigationState.recentPages = [{ id, openedAt: Date.now() }, ...navigationState.recentPages.filter(entry => entry.id !== id)].slice(0, recentPageLimit);
}
export function toggleGroup(key: string): void {
    const groups = navigationState.expandedGroups;
    navigationState.expandedGroups = groups.includes(key) ? groups.filter(item => item !== key) : [...groups, key];
}

export async function restoreTabs(): Promise<void> {
    window.api.app.editorStarted();
    const [tabs, navigation] = await Promise.all([window.api.workspace.loadTabs(), window.api.workspace.loadNavigation()]);
    Object.assign(navigationState, navigation);
    const state = restoreTabState(tabs);
    if (state) Object.assign(tabState, state);
    else {
        const id = getGroupID(), tab = { id: getTabID(), view: copyData(destinationViews.overview) };
        Object.assign(tabState, { groups: [{ id, tabs: [tab], activeTabId: tab.id }], focusedGroupId: id, layout: { type: "group", groupId: id } });
    }
}
export function persistTabs(): Promise<void> {
    return window.api.workspace.saveTabs(copyData(tabState), copyData(navigationState));
}