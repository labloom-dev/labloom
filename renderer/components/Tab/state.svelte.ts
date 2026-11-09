import { getGroupID } from "./ids";
import type { TabState } from "./defs";
import { SvelteSet } from "svelte/reactivity";

const initialGroupId = getGroupID();
export const visitedTabs = new SvelteSet<string>();

export const tabState = $state<TabState>({
    groups: [{ id: initialGroupId, tabs: [], activeTabId: null }],
    focusedGroupId: initialGroupId,
    layout: { type: "group", groupId: initialGroupId }
});