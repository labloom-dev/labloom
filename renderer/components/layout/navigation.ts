import { t } from "../../i18n.svelte";
import { tick } from "svelte";
import { visits } from "../Tab/activity.svelte";
import { type Destination } from "./destinations";
import type { GroupID, Tab } from "../Tab/defs";
import { activateTab, addTab, getTabID, splitGroup } from "../Tab/api";
import { tabState } from "../Tab/state.svelte";
import type { View } from "../../../shared/workspace/views";
import { requestAnchor } from "../Tab/anchors";
import { workspaceHistory } from "../../../shared/history/ipc";
import { type AttributeValue } from "../../../shared/types/attributes";
import { copyData } from "../copy-data";
import { perform } from "../Knowledge/feedback.svelte";
import { write } from "../Knowledge/page-sessions";

import { defaultLibrary } from "../../../shared/workspace/library";
import { defaultOverviewDate, defaultOverviewStatus as status } from "../../../shared/workspace/overview";

export type { Destination } from "./destinations";

export const destinationViews: Record<Destination, View> = {
    overview: { type: "overview", params: { status, date: defaultOverviewDate } },
    library: { type: "library", params: defaultLibrary() },
    papers: { type: "library", params: defaultLibrary(true) },
    calendar: { type: "calendar", params: { date: { kind: "attribute", type: "day", id: "schedule_date" }, start: { kind: "attribute", type: "minute", id: "schedule_start" }, status } },
    feed: { type: "feed", params: {} },
    settings: { type: "settings", params: {} },
    attributes: { type: "attributes", params: {} },
    about: { type: "about", params: {} }
};

function canonical(_key: string, value: unknown): unknown {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return value;
}
export function sameView(left: View | undefined, right: View): boolean {
    return left?.type === right.type && JSON.stringify(left.params, canonical) === JSON.stringify(right.params, canonical);
}
function openView(view: View): Tab {
    const existing = tabState.groups.flatMap(group => group.tabs).find(tab => sameView(tab.view, view));
    if (existing) {
        activateTab(existing.id);
        return existing;
    }
    const tab = { id: getTabID(), view: copyData(view) };
    addTab(tabState.focusedGroupId, tab);
    return tab;
}
export function openDestination(type: Destination): Tab {
    if (type === "feed" || type === "overview") {
        const focused = tabState.groups.find(group => group.id === tabState.focusedGroupId);
        const existing = focused?.tabs.find(tab => tab.view.type === type)
            ?? tabState.groups.flatMap(group => group.tabs).find(tab => tab.view.type === type);
        if (existing) {
            activateTab(existing.id);
            return existing;
        }
    }
    return openView(destinationViews[type]);
}

export function splitCurrent(groupId: GroupID, direction: "horizontal" | "vertical"): GroupID | null {
    const group = tabState.groups.find(item => item.id === groupId);
    const tab = group?.tabs.find(item => item.id === group.activeTabId);
    const id = splitGroup(groupId, direction);
    if (id && tab) addTab(id, { id: getTabID(), view: copyData(tab.view) });
    return id;
}
async function focusOpenedPage(tabId: string): Promise<void> {
    await tick();
    const find = (): HTMLElement | null => document.querySelector(`[data-tabs-content][data-value="${CSS.escape(tabId)}"] .tiptap`);
    if (!find() && !await visits.settled(tabId)) return;
    if (tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId === tabId) find()?.focus({ preventScroll: true });
}
export function openPage(id: string, options: { duplicate?: boolean; fileId?: string; anchorId?: string; currentGroup?: boolean; otherGroup?: boolean } = {}): void {
    let groupId = tabState.focusedGroupId;
    if (options.otherGroup) groupId = tabState.groups.find(group => group.id !== groupId)?.id ?? splitCurrent(groupId, "horizontal") ?? groupId;
    const groups = options.currentGroup || options.otherGroup ? tabState.groups.filter(group => group.id === groupId) : tabState.groups;
    const existing = !options.duplicate && groups.flatMap(group => group.tabs).find(tab => tab.view.type === "page" && tab.view.params.page.id === id);
    const tabId = existing ? existing.id : getTabID();
    if (options.anchorId) requestAnchor(tabId, options.anchorId);
    if (existing) activateTab(tabId);
    else addTab(groupId, { id: tabId, view: { type: "page", params: { page: { kind: "page", id }, ...(options.fileId ? { fileId: options.fileId } : {}) } } });
    void focusOpenedPage(tabId);
}
export async function openTarget(target: { kind: "page" | "block"; id: string }, otherGroup = false): Promise<void> {
    const resolved = await window.api.pages.resolve(target);
    if (!resolved || resolved.status === "deleted") {
        const { notify } = await import("../Knowledge/feedback.svelte"); notify(t("shell.targetDeleted")); return;
    }
    if (target.kind === "page") openPage(target.id, { otherGroup });
    else if (resolved.ownerId) openPage(resolved.ownerId, { otherGroup, anchorId: target.id });
}

export function createPage(initial: Record<string, AttributeValue> = {}, kind: "editable" | "paper" = "editable"): void {
    void perform(async () => {
        const page = await write(() => window.api.pages.create(workspaceHistory, "", initial, undefined, kind));
        openPage(page.id);
    });
}