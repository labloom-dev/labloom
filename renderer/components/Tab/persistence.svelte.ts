import { copyData } from "../copy-data";
import { destinationViews } from "../layout/navigation";
import { getTabID, getGroupID } from "./ids";
import { tabState } from "./state.svelte";
import { restoreTabState } from "./restore";

export async function restoreTabs(): Promise<void> {
    window.api.app.editorStarted();
    const state = restoreTabState(await window.api.workspace.loadTabs());
    if (state) Object.assign(tabState, state);
    else {
        const id = getGroupID(), tab = { id: getTabID(), view: copyData(destinationViews.overview) };
        Object.assign(tabState, { groups: [{ id, tabs: [tab], activeTabId: tab.id }], focusedGroupId: id, layout: { type: "group", groupId: id } });
    }
}
export function persistTabs(): Promise<void> {
    return window.api.workspace.saveTabs(copyData(tabState));
}