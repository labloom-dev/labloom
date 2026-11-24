import typia, { type tags } from "typia";
import type { SavedTabs } from "../../../shared/workspace/tabs";
import type { View } from "../../../shared/workspace/views";
import type { TabState } from "./defs";

import { defaultOverviewDate, defaultOverviewStatus } from "../../../shared/workspace/overview";
import { defaultLibrary } from "../../../shared/workspace/library";
import { record } from "../../../shared/attrs/values";

type Layout = SavedTabs["layout"];
type StoredGroup = { id: string; tabs: { id: string & tags.MinLength<1>; view: unknown }[]; activeTabId: string | null };
const isLayout = typia.createIs<{ groups: StoredGroup[]; focusedGroupId: string; layout: Layout }>();
const isView = typia.createEquals<View>();
const isPageLocation = typia.createEquals<Pick<Extract<View, { type: "page" }>["params"], "page" | "fileId">>();

function validLibrary(view: Extract<View, { type: "library" }>): boolean {
    const { columns, tags, filters, pageType, paperOnly } = view.params;
    const unique = (ids: string[]): boolean => new Set(ids).size === ids.length;
    return !(paperOnly && pageType) && (!columns || columns.some(c => c.id === "title") && unique(columns.map(c => c.id))) && unique(tags) && unique(filters.map(f => f.attribute.id));
}

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
            const view = tab.view;
            if (isView(view) && (view.type !== "library" || validLibrary(view))) tabs.push({ id: tab.id, view });
            else if (record(view) && view.type === "page" && record(view.params) &&
                Object.keys(view.params).every(key => ["page", "fileId", "showProperties", "infoWidth", "paperSidebar"].includes(key))) {
                const { page, fileId } = view.params;
                const location = { page, ...(fileId === undefined ? {} : { fileId }) };
                if (isPageLocation(location)) tabs.push({ id: tab.id, view: { type: "page", params: location } });
            }
            else if (record(view) && view.type === "overview") tabs.push({ id: tab.id, view: {
                type: "overview", params: { status: defaultOverviewStatus, date: defaultOverviewDate }
            } });
            else if (record(view) && view.type === "feed") tabs.push({ id: tab.id, view: { type: "feed", params: {} } });
            else if (record(view) && view.type === "library") {
                const papers = record(view.params) && view.params.paperOnly === true;
                tabs.push({ id: tab.id, view: { type: "library", params: defaultLibrary(papers) } });
            }
        }
        const activeTabId = group.activeTabId === null ? null : tabs.find(tab => tab.id === group.activeTabId)?.id ?? tabs[0]?.id ?? null;
        groups.push({ id: group.id, tabs, activeTabId });
    }
    return { groups, layout: state.layout, focusedGroupId: state.focusedGroupId } as TabState;
}