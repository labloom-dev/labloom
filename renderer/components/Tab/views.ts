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
import { viewMenu } from "./view-menu";
import { t } from "../../i18n.svelte";
import { type MenuItem } from "../base/Menu.svelte";
import { type IconName } from "../utils/Icon.svelte";
import { type TabID } from "./defs";
import { libraryHeader, pageHeader } from "../Knowledge/page-header";
import { pageTitle } from "./page-titles";

export type ViewProps<K extends keyof ViewParams> = {
    tabId: string; params: ViewParams[K]; onparams: (params: ViewParams[K]) => void; source: HistorySource;
};
export type HeaderActions = {
    buttons: { icon: IconName; label: string; shortcut?: string; pressed?: boolean; onclick: () => void }[];
    menu: MenuItem[];
};
type Definition<K extends keyof ViewParams> = {
    component: Component<ViewProps<K>>;
    title: (params: ViewParams[K]) => Readable<string>;
    history: (params: ViewParams[K]) => HistorySource;
    keepMounted: boolean;
    header?: (id: TabID, params: ViewParams[K]) => HeaderActions;
};
const workspace = (): HistorySource => workspaceHistory;
const named = (key: Parameters<typeof t>[0]) => () => toStore(() => t(key));
// Standalone screens also render outside the tab host and take no tab inputs.
const standalone = (screen: Component): Component<{ tabId: string }> => (anchor, { tabId }) => Standalone(anchor, { tabId, screen });
const views: { [K in keyof ViewParams]: Definition<K> } = {
    page: { component: PageView, header: pageHeader, title: p => pageTitle(p.page.id), history: p => ({ kind: "page", id: p.page.id }), keepMounted: true },
    library: { component: Library, header: libraryHeader, title: p => toStore(() => t(p.scope === "trash" ? "shell.trashView" : p.scope === "pinned" ? "shell.pinnedView" : p.paperOnly ? "command.papers" : "command.library")), history: workspace, keepMounted: true },
    calendar: { component: Calendar, title: named("command.calendar"), history: workspace, keepMounted: true, header: id => ({ buttons: [], menu: viewMenu(id) }) },
    overview: { component: Overview, title: named("command.overview"), history: workspace, keepMounted: false, header: id => ({ buttons: [], menu: viewMenu(id) }) },
    attributes: { component: AttributeManagement, title: named("command.attributes"), history: workspace, keepMounted: false },
    feed: { component: FeedView, title: named("shell.feedView"), history: workspace, keepMounted: true, header: id => ({ buttons: [], menu: viewMenu(id) }) },
    settings: { component: standalone(Settings), title: named("command.settings"), history: workspace, keepMounted: false },
    about: { component: standalone(About), title: named("command.about"), history: workspace, keepMounted: false }
};
export function definitionFor<K extends keyof ViewParams>(type: K): Definition<K> {
    return views[type];
}