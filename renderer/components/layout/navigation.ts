import type { IconName } from "../utils/Icon.svelte";
import type { Tab } from "../Tab/defs";
import { activateTab, addTab, getTabID } from "../Tab/api";
import { tabState } from "../Tab/state.svelte";
import { type uuid } from "../../../shared/types/uuid";
import { type PageKind } from "../../../shared/types/content";
import { type AttributeValue } from "../../../shared/types/attributes";
import { perform, saveAll } from "../Knowledge/state.svelte";

export const destinations = [
    { type: "overview", title: "我的花园", icon: "home" },
    { type: "feed", title: "订阅动态", icon: "feed" },
    { type: "reader-test", title: "文献阅读", icon: "book" },
    { type: "settings", title: "偏好设置", icon: "settings" },
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

export function openPage(id: string, options: { duplicate?: boolean; anchorId?: string } = {}): void {
    const existing = !options.duplicate && tabState.groups.flatMap(group => group.tabs).find(tab => tab.type === "page" && tab.pageId === id);
    if (existing) {
        if (existing.type === "page" && options.anchorId) existing.anchorId = options.anchorId;
        activateTab(existing.id);
    }
    else addTab(tabState.focusedGroupId, { id: getTabID(), title: "页面", type: "page", pageId: id as uuid, anchorId: options.anchorId });
}

export function createPage(kind: PageKind = "editable", initial: Record<string, AttributeValue> = {}): void {
    void perform(async () => {
        if (!await saveAll()) return;
        const page = await window.api.knowledge.create(kind, "", initial);
        openPage(page.id);
    });
}