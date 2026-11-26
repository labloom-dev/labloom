import typia, { type tags } from "typia";
import type { SavedTabs } from "../../../shared/workspace/tabs";
import type { View } from "../../../shared/workspace/views";
import type { TabState } from "./defs";

import { defaultOverviewDate, defaultOverviewStatus } from "../../../shared/workspace/overview";
import { defaultCalendar } from "../../../shared/workspace/calendar";
import { defaultTable, defaultTrash, repairPaperFields, type TableViewType } from "../../../shared/workspace/table";
import { fieldKey } from "../../../shared/workspace/query";
import { record } from "../../../shared/attrs/values";

type Layout = SavedTabs["layout"];
type StoredGroup = { id: string; tabs: { id: string & tags.MinLength<1>; view: unknown }[]; activeTabId: string | null };
const isLayout = typia.createIs<{ groups: StoredGroup[]; focusedGroupId: string; layout: Layout }>();
const isView = typia.createEquals<View>();
const isPageLocation = typia.createEquals<Pick<Extract<View, { type: "page" }>["params"], "page" | "fileId">>();

function validTableLayout(view: Extract<View, { type: TableViewType | "trash" }>): boolean {
    const { columns } = view.params;
    const sort = view.type === "trash" ? view.params.sort : view.params.query.sort;
    const unique = (ids: string[]): boolean => new Set(ids).size === ids.length;
    return (!columns || columns.some(c => c.id === "title") && unique(columns.map(c => c.id))) && unique(sort.map(item => fieldKey(item.field)));
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
            let view = tab.view;
            if (isView(view) && view.type === "papers") view = { ...view, params: repairPaperFields(view.params) };
            if (isView(view) && (view.type !== "library" && view.type !== "papers" && view.type !== "trash" || validTableLayout(view))) tabs.push({ id: tab.id, view });
            else if (record(view) && view.type === "page" && record(view.params) &&
                Object.keys(view.params).every(key => ["page", "fileId", "showProperties", "infoWidth", "paperSidebar"].includes(key))) {
                const { page, fileId } = view.params;
                const location = { page, ...(fileId === undefined ? {} : { fileId }) };
                if (isPageLocation(location)) tabs.push({ id: tab.id, view: { type: "page", params: location } });
            }
            else if (record(view) && view.type === "overview") tabs.push({ id: tab.id, view: {
                type: "overview", params: { status: defaultOverviewStatus, date: defaultOverviewDate }
            } });
            else if (record(view) && view.type === "calendar") tabs.push({ id: tab.id, view: { type: "calendar", params: defaultCalendar } });
            else if (record(view) && (view.type === "feed" || view.type === "attributes" || view.type === "settings" || view.type === "about")) {
                tabs.push({ id: tab.id, view: { type: view.type, params: {} } });
            }
            else if (record(view) && (view.type === "table" || view.type === "library")) tabs.push({ id: tab.id, view: { type: "library", params: defaultTable() } });
            else if (record(view) && view.type === "papers") tabs.push({ id: tab.id, view: { type: "papers", params: defaultTable("papers") } });
            else if (record(view) && view.type === "trash") tabs.push({ id: tab.id, view: { type: "trash", params: defaultTrash() } });
        }
        const activeTabId = group.activeTabId === null ? null : tabs.find(tab => tab.id === group.activeTabId)?.id ?? tabs[0]?.id ?? null;
        groups.push({ id: group.id, tabs, activeTabId });
    }
    return { groups, layout: state.layout, focusedGroupId: state.focusedGroupId } as TabState;
}