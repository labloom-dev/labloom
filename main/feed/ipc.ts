import { shell, type BrowserWindow } from "electron";
import typia from "typia";
import { feedChannels, feedChanged, type FeedAPI } from "../../shared/feed/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as events from "../knowledge/events";
import * as feed from "./service";

type Args<Key extends keyof typeof feedChannels> = Parameters<FeedAPI[Key]>;

const routes = {
    getState: route(typia.createAssert<Args<"getState">>(invalid), feed.getState),
    getRows: route(typia.createAssert<Args<"getRows">>(invalid), feed.getRows),
    getItem: route(typia.createAssert<Args<"getItem">>(invalid), feed.getItem),
    resolveSource: route(typia.createAssert<Args<"resolveSource">>(invalid), feed.resolveSource),
    discardSource: route(typia.createAssert<Args<"discardSource">>(invalid), feed.discardSource),
    saveSource: route(typia.createAssert<Args<"saveSource">>(invalid), feed.saveSource),
    setSourceStatus: route(typia.createAssert<Args<"setSourceStatus">>(invalid), feed.setSourceStatus),
    refresh: route(typia.createAssert<Args<"refresh">>(invalid), feed.refresh),
    setRead: route(typia.createAssert<Args<"setRead">>(invalid), feed.setRead),
    markAllRead: route(typia.createAssert<Args<"markAllRead">>(invalid), feed.markAllRead),
    setPosition: route(typia.createAssert<Args<"setPosition">>(invalid), feed.setPosition),
    setKeywords: route(typia.createAssert<Args<"setKeywords">>(invalid), feed.setKeywords),
    importItem: route(typia.createAssert<Args<"importItem">>(invalid), feed.importItem),
    fetchPDF: route(typia.createAssert<Args<"fetchPDF">>(invalid), feed.fetchPDF),
    openItem: route(typia.createAssert<Args<"openItem">>(invalid), id => shell.openExternal(feed.itemURL(id)))
} satisfies Routes<FeedAPI>;
export function registerFeedIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, feedChannels, routes);
    const unsubscribe = events.subscribe(event => {
        if (event.type === "feed" && !contents.isDestroyed()) contents.send(feedChanged);
    });
    contents.once("destroyed", unsubscribe);
}