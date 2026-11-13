import { tick } from "svelte";
import { visits } from "../Tab/activity.svelte";
import type { IconName } from "../utils/Icon.svelte";
import type { GroupID, Tab } from "../Tab/defs";
import { activateTab, addTab, getTabID, splitGroup } from "../Tab/api";
import { tabState } from "../Tab/state.svelte";
import { type uuid } from "../../../shared/types/uuid";
import { type PageKind, type PageRecord } from "../../../shared/types/content";
import { type AttributeValue } from "../../../shared/types/attributes";
import { perform, saveAll, writeFromTab } from "../Knowledge/state.svelte";

export const destinations = [
    { type: "overview", title: "我的花园", icon: "home" },
    { type: "feed", title: "订阅动态", icon: "feed" },
    { type: "library", title: "知识库", icon: "library" },
    { type: "papers", title: "文献库", icon: "book" },
    { type: "calendar", title: "研究日历", icon: "calendar" },
    { type: "settings", title: "偏好设置", icon: "settings" },
    { type: "attributes", title: "属性管理", icon: "settings" },
    { type: "about", title: "关于知织", icon: "home" }
] satisfies { type: Exclude<Tab["type"], "page">; title: string; icon: IconName }[];

export type Destination = typeof destinations[number]["type"];

export function openDestination(type: Destination): void {
    const existing = tabState.groups.flatMap(group => group.tabs).find(tab => tab.type === type);
    if (existing) activateTab(existing.id);
    else {
        const destination = destinations.find(item => item.type === type)!;
        addTab(tabState.focusedGroupId, { id: getTabID(), title: destination.title, type });
    }
}

export function splitCurrent(groupId: GroupID, direction: "horizontal" | "vertical"): GroupID | null {
    const group = tabState.groups.find(item => item.id === groupId);
    const tab = group?.tabs.find(item => item.id === group.activeTabId);
    const id = splitGroup(groupId, direction);
    if (id && tab) addTab(id, { ...tab, id: getTabID() });
    return id;
}
async function focusOpenedPage(tabId: string): Promise<void> {
    await tick();
    const find = (): HTMLElement | null => document.querySelector(`[data-tabs-content][data-value="${CSS.escape(tabId)}"] .tiptap`);
    if (!find() && !await visits.settled(tabId)) return;
    if (tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId === tabId) find()?.focus({ preventScroll: true });
}
export function openPage(id: string, options: { duplicate?: boolean; anchorId?: string; currentGroup?: boolean; otherGroup?: boolean } = {}): void {
    let groupId = tabState.focusedGroupId;
    if (options.otherGroup) groupId = tabState.groups.find(group => group.id !== groupId)?.id ?? splitCurrent(groupId, "horizontal") ?? groupId;
    const groups = options.currentGroup || options.otherGroup ? tabState.groups.filter(group => group.id === groupId) : tabState.groups;
    const existing = !options.duplicate && groups.flatMap(group => group.tabs).find(tab => tab.type === "page" && tab.pageId === id);
    if (existing) {
        if (existing.type === "page" && options.anchorId) existing.anchorId = options.anchorId;
        activateTab(existing.id);
        void focusOpenedPage(existing.id);
    }
    else {
        const tabId = getTabID();
        addTab(groupId, { id: tabId, title: "页面", type: "page", pageId: id as uuid, anchorId: options.anchorId });
        void focusOpenedPage(tabId);
    }
}
export async function openTarget(target: { kind: "page" | "block"; id: string }, otherGroup = false): Promise<void> {
    const resolved = await window.api.knowledge.resolve(target);
    if (!resolved || resolved.status === "deleted") {
        const { notify } = await import("../Knowledge/feedback.svelte"); notify("目标已删除"); return;
    }
    if (target.kind === "page") openPage(target.id, { otherGroup });
    else {
        // Existing references expose no owner page, so use the indexed backlinks lookup through a containing page search.
        let offset = 0;
        const keyword = resolved.text.trim().slice(0, 80);
        while (true) {
            const result = await window.api.knowledge.list({ keyword, limit: 100, offset });
            for (const page of result.items) {
                const record = await window.api.knowledge.get(page.id);
                if (record.blocks[target.id]) {
                    openPage(page.id, { otherGroup, anchorId: target.id }); return;
                }
            }
            offset += result.items.length;
            if (!result.items.length || offset >= result.total) return;
        }
    }
}

export function createPage(kind: PageKind = "editable", initial: Record<string, AttributeValue> = {}): void {
    const source = tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId;
    void perform(async () => {
        const create = (): Promise<PageRecord> => window.api.knowledge.create(kind, "", initial, undefined, source ?? undefined);
        const page = source ? await writeFromTab(source, create) : await saveAll() && await create();
        if (page) openPage(page.id);
    });
}