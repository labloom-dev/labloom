import type { tags } from "typia";
import type { TabId } from "../ipc/contract";
import type { View } from "./views";

type SavedTab = { id: TabId; view: View };
type Group = { id: string; tabs: SavedTab[]; activeTabId: TabId | null };
type Layout = { type: "group"; groupId: string } | { type: "split"; direction: "horizontal" | "vertical"; ratio: number & tags.Minimum<0.1> & tags.Maximum<0.9>; children: [Layout, Layout] };
export type SavedTabs = { groups: Group[]; focusedGroupId: string; layout: Layout };