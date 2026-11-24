import * as shortcuts from "../../../shared/content/commands";
import type { ViewParams } from "../../../shared/workspace/views";
import * as i18n from "../../i18n.svelte";
import * as tabs from "../Tab/api";
import * as activity from "../Tab/activity.svelte";
import type { TabID } from "../Tab/defs";
import type { HeaderActions } from "../Tab/views";
import { viewMenu } from "../Tab/view-menu";
import * as feedback from "./feedback.svelte";
import * as sessions from "./page-sessions";
import type { PageSession } from "./page-session.svelte";

export function toggleProperties(id: TabID, params: ViewParams["page"]): void {
    const paper = sessions.mountedSession(id, params.page.id)?.state.page?.kind === "paper";
    tabs.setViewParams(id, { ...params, showProperties: !(params.showProperties ?? paper) });
}

export function toggleTrash(session: PageSession): void {
    const page = session.state.page;
    if (page) void feedback.perform(() => session.action((token, writeId) => page.attributes.deleted
        ? window.api.pages.restore([page.id], session.source, writeId)
        : window.api.pages.trash([page.id], session.source, token, writeId)));
}

export function pageActions(shown: boolean, deleted: boolean | undefined, busy: boolean, toggle: () => void, trash: () => void): HeaderActions {
    return {
        buttons: [{ icon: "layout-sidebar-right", label: i18n.t("editor.properties"), shortcut: shortcuts.commands.toggleProperties.shortcut, pressed: shown, onclick: toggle }],
        menu: deleted === undefined ? [] : [{ label: i18n.t(deleted ? "editor.restore" : "pageAction.trash"), icon: deleted ? "undo" : "trash", disabled: busy, onselect: trash }]
    };
}

export function pageHeader(id: TabID, params: ViewParams["page"]): HeaderActions {
    const session = sessions.mountedSession(id, params.page.id), page = session?.state.page;
    const shown = params.showProperties ?? page?.kind === "paper", toggle = (): void => toggleProperties(id, params);
    const actions = pageActions(
        shown, page ? !!page.attributes.deleted : undefined, activity.readingTabs.has(id), toggle,
        () => {
            if (session) toggleTrash(session);
        }
    );
    const subscription = page?.kind === "feed" ? viewMenu(id) : [];
    if (subscription.length) actions.menu.push({ separator: true }, ...subscription);
    return actions;
}

export function toggleLibraryProperties(id: TabID, params: ViewParams["library"]): void {
    tabs.setViewParams(id, { ...params, showProperties: params.showProperties === false });
}
export function libraryHeader(id: TabID, params: ViewParams["library"]): HeaderActions {
    return { buttons: [{ icon: "layout-sidebar-right", label: i18n.t("editor.properties"), shortcut: shortcuts.commands.toggleProperties.shortcut,
        pressed: params.showProperties !== false, onclick: () => toggleLibraryProperties(id, params) }], menu: [] };
}