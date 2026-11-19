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
    readNotice: route(typia.createAssert<Args<"readNotice">>(invalid), timers.read)
} satisfies Routes<TimersAPI>;
export function registerTimersIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, timersChannels, routes);
}