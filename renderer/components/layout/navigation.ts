import type { IconName } from "../utils/Icon.svelte";
import type { Tab } from "../Tab/defs";
import { activateTab, addTab, getTabID } from "../Tab/api";
import { tabState } from "../Tab/state.svelte";

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