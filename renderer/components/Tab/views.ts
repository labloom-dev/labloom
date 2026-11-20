import type { Component } from "svelte";
import { toStore, type Readable } from "svelte/store";
import { type ViewParams } from "../../../shared/workspace/views";
import { workspaceHistory, type HistorySource } from "../../../shared/history/ipc";
import Standalone from "./Standalone.svelte";
import PageView from "../Knowledge/PageView.svelte";
import Library from "../Knowledge/Library.svelte";
import Calendar from "../Knowledge/Calendar.svelte";
import AttributeManagement from "../Knowledge/AttributeManagement.svelte";
import Overview from "../tabs/Overview.svelte";
import About from "../tabs/About.svelte";
import Settings from "../tabs/Settings.svelte";
import FeedView from "../Feed/FeedView.svelte";
import { t } from "../../i18n.svelte";
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
const workspace = (): HistorySource => workspaceHistory;
const named = (key: Parameters<typeof t>[0]) => () => toStore(() => t(key));
// Standalone screens also render outside the tab host and take no tab inputs.
const standalone = (screen: Component): Component<{ tabId: string }> => (anchor, { tabId }) => Standalone(anchor, { tabId, screen });
const views: { [K in keyof ViewParams]: Definition<K> } = {
    page: { component: PageView, title: p => pageTitle(p.page.id), history: p => ({ kind: "page", id: p.page.id }), keepMounted: true },
    library: { component: Library, title: p => toStore(() => t(p.scope === "trash" ? "shell.trashView" : p.scope === "pinned" ? "shell.pinnedView" : p.pageType?.type === "paper" ? "command.papers" : "command.library")), history: workspace, keepMounted: true },
    calendar: { component: Calendar, title: named("shell.calendarView"), history: workspace, keepMounted: true },
    overview: { component: Overview, title: named("shell.overviewView"), history: workspace, keepMounted: false },
    attributes: { component: AttributeManagement, title: named("command.attributes"), history: workspace, keepMounted: false },
    feed: { component: standalone(FeedView), title: named("shell.feedView"), history: workspace, keepMounted: false },
    settings: { component: standalone(Settings), title: named("command.settings"), history: workspace, keepMounted: false },
    about: { component: standalone(About), title: named("command.about"), history: workspace, keepMounted: false }
};
export function definitionFor<K extends keyof ViewParams>(type: K): Definition<K> {
    return views[type];
}