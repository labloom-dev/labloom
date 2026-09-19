import { v4 } from "uuid";
import type { GroupID, TabState } from "./defs";

const initialGroupId = `group-${v4()}` as GroupID;

export const tabState = $state<TabState>({
    groups: [{ id: initialGroupId, tabs: [], activeTabId: null }],
    focusedGroupId: initialGroupId,
    layout: { type: "group", groupId: initialGroupId }
});