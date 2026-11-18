import type { TabId } from "../ipc/contract";

type SavedTab = { id: TabId; title: string } & (
    { type: "page"; pageId: string; anchorId?: string } |
    { type: "overview" | "about" | "settings" | "feed" | "library" | "papers" | "calendar" | "attributes" }
);
type Group = { id: string; tabs: SavedTab[]; activeTabId: TabId | null };
type Layout = { type: "group"; groupId: string } | { type: "split"; direction: "horizontal" | "vertical"; ratio: number; children: [Layout, Layout] };
export type SavedTabs = { groups: Group[]; focusedGroupId: string; layout: Layout };