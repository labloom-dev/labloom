import { type BrowserWindow } from "electron";
import typia from "typia";
import { historyChannels, type HistoryAPI } from "../../shared/history/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as history from "../knowledge/history";

type Args<Key extends keyof typeof historyChannels> = Parameters<HistoryAPI[Key]>;

export const routes = {
    state: route(typia.createAssert<Args<"state">>(invalid), history.state),
    apply: route(typia.createAssert<Args<"apply">>(invalid), history.apply),
    closeTab: route(typia.createAssert<Args<"closeTab">>(invalid), history.close)
} satisfies Routes<HistoryAPI>;
export function registerHistoryIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, historyChannels, routes);
}