import typia, { type tags } from "typia";
import type { SavedTabs } from "../../../shared/workspace/tabs";
import type { View } from "../../../shared/workspace/views";
import type { TabState } from "./defs";

type Layout = SavedTabs["layout"];
type StoredGroup = { id: string; tabs: { id: string & tags.MinLength<1>; view: unknown }[]; activeTabId: string | null };
const isLayout = typia.createIs<{ groups: StoredGroup[]; focusedGroupId: string; layout: Layout }>();
const isView = typia.createEquals<View>();

export function restoreTabState(state: unknown): TabState | undefined {
    if (!isLayout(state)) return;
    const groupIds = new Set(state.groups.map(group => group.id));
    if (groupIds.size !== state.groups.length || !groupIds.has(state.focusedGroupId)) return;
    const visit = (node: Layout): boolean => node.type === "group" ? groupIds.delete(node.groupId) : node.children.every(visit);
    if (!visit(state.layout) || groupIds.size) return;

    const tabIds = new Set<string>();
    const groups: SavedTabs["groups"] = [];
    for (const group of state.groups) {
        if (group.activeTabId !== null && !group.tabs.some(tab => tab.id === group.activeTabId)) return;
        const tabs: SavedTabs["groups"][number]["tabs"] = [];
        for (const tab of group.tabs) {
            if (!Object.hasOwn(tab, "view") || tabIds.has(tab.id)) return;
            tabIds.add(tab.id);
            if (isView(tab.view)) tabs.push({ id: tab.id, view: tab.view });
        }
        const activeTabId = group.activeTabId === null ? null : tabs.find(tab => tab.id === group.activeTabId)?.id ?? tabs[0]?.id ?? null;
        groups.push({ id: group.id, tabs, activeTabId });
    }
    return { groups, layout: state.layout, focusedGroupId: state.focusedGroupId } as TabState;
}