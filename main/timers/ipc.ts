import { type BrowserWindow } from "electron";
import typia from "typia";
import { timersChannels, type TimersAPI } from "../../shared/timers/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as timers from "../knowledge/timers";

type Args<Key extends keyof typeof timersChannels> = Parameters<TimersAPI[Key]>;

const routes = {
    settings: route(typia.createAssert<Args<"settings">>(invalid), timers.settings),
    set: route(typia.createAssert<Args<"set">>(invalid), timers.set),
    notices: route(typia.createAssert<Args<"notices">>(invalid), timers.notices),
    unreadCount: route(typia.createAssert<Args<"unreadCount">>(invalid), timers.unreadCount),
    readNotice: route(typia.createAssert<Args<"readNotice">>(invalid), timers.read),
    unreadNotice: route(typia.createAssert<Args<"unreadNotice">>(invalid), timers.unread),
    readAllNotices: route(typia.createAssert<Args<"readAllNotices">>(invalid), timers.readAll),
    clearNotice: route(typia.createAssert<Args<"clearNotice">>(invalid), timers.clear),
    clearAllNotices: route(typia.createAssert<Args<"clearAllNotices">>(invalid), timers.clearAll)
} satisfies Routes<TimersAPI>;
export function registerTimersIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, timersChannels, routes);
}