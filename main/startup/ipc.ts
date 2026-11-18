import { type BrowserWindow } from "electron";
import typia from "typia";
import { startupChannels, type StartupAPI } from "../../shared/startup/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as startup from "./startup";
import * as dialogs from "../ui/fileDialogs";

type Args<Key extends keyof typeof startupChannels> = Parameters<StartupAPI[Key]>;

export function registerStartupIPCs(window: BrowserWindow): void {
    const routes = {
        getState: route(typia.createAssert<Args<"getState">>(invalid), () => startup.state),
        retry: route(typia.createAssert<Args<"retry">>(invalid), dialogs.retryWorkspace),
        chooseWorkspace: route(typia.createAssert<Args<"chooseWorkspace">>(invalid), action => dialogs.chooseWorkspace(window, action))
    } satisfies Routes<StartupAPI>;
    const contents = window.webContents;
    register(contents, startupChannels, routes);
}