import type { Component } from "svelte";
import { readable, type Readable } from "svelte/store";
import type { View, ViewParams } from "../../../shared/workspace/views";
import type { HistorySource } from "../../../shared/history/ipc";
import PageView from "../Knowledge/PageView.svelte";
import Library from "../Knowledge/Library.svelte";
import Calendar from "../Knowledge/Calendar.svelte";
import AttributeManagement from "../Knowledge/AttributeManagement.svelte";
import Overview from "../tabs/Overview.svelte";
import About from "../tabs/About.svelte";
import Settings from "../tabs/Settings.svelte";
import FeedView from "../Feed/FeedView.svelte";
import { pageTitle } from "./page-titles";

export type ViewProps<K extends keyof ViewParams> = {
    tabId: string; params: ViewParams[K]; onparams: (params: ViewParams[K]) => void; source: HistorySource;
};
type Definition<K extends keyof ViewParams> = {
    component: Component<ViewProps<K>>;
    title: (params: ViewParams[K]) => Readable<string>;
    history: (params: ViewParams[K]) => HistorySource;
    keepMounted: boolean;
};
const workspace = (): HistorySource => ({ kind: "workspace" });
const named = (name: string) => () => readable(name);
// Standalone screens also render outside the tab host and take no tab inputs.
const standalone = (component: Component) => (anchor: Parameters<Component>[0]) => component(anchor, {});
const views: { [K in keyof ViewParams]: Definition<K> } = {
    page: { component: PageView, title: p => pageTitle(p.page.id), history: p => ({ kind: "page", id: p.page.id }), keepMounted: true },
    library: { component: Library, title: p => readable(p.scope === "trash" ? "回收站" : p.scope === "pinned" ? "已固定" : p.pageType?.type === "paper" ? "文献库" : "知识库"), history: workspace, keepMounted: true },
    calendar: { component: Calendar, title: named("研究日历"), history: workspace, keepMounted: true },
    overview: { component: Overview, title: named("我的花园"), history: workspace, keepMounted: false },
    attributes: { component: AttributeManagement, title: named("属性管理"), history: workspace, keepMounted: false },
    feed: { component: standalone(FeedView), title: named("订阅动态"), history: workspace, keepMounted: false },
    settings: { component: standalone(Settings), title: named("偏好设置"), history: workspace, keepMounted: false },
    about: { component: standalone(About), title: named("关于知织"), history: workspace, keepMounted: false }
};
export function definitionFor<K extends keyof ViewParams>(type: K): Definition<K> {
    return views[type];
}

export function historySource(view: View): HistorySource {
    return definitionFor(view.type).history(view.params);
}