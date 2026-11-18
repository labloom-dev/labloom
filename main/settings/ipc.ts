import { type BrowserWindow } from "electron";
import typia from "typia";
import { settingsChannels, settingsChanged, type SettingsAPI } from "../../shared/settings/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as settings from "./store";

type Args<Key extends keyof typeof settingsChannels> = Parameters<SettingsAPI[Key]>;

export function registerSettingsIPCs(window: BrowserWindow, rememberWindow: () => void): void {
    const routes = {
        get: route(typia.createAssert<Args<"get">>(invalid), settings.get),
        update: route(typia.createAssert<Args<"update">>(invalid), settings.update),
        flush: route(typia.createAssert<Args<"flush">>(invalid), revision => {
            rememberWindow();
            return settings.flush(revision);
        })
    } satisfies Routes<SettingsAPI>;
    const contents = window.webContents;
    register(contents, settingsChannels, routes);
    const unsubscribe = settings.subscribe(snapshot => {
        if (!contents.isDestroyed()) contents.send(settingsChanged, snapshot);
    });
    contents.once("destroyed", unsubscribe);
}