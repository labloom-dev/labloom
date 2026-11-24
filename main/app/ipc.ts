import { app, type BrowserWindow } from "electron";
import { machine, type as osType } from "node:os";
import typia from "typia";
import { appChannels, appQueryChannels, type AppMessages, type AppQueries } from "../../shared/app/ipc";
import { invalid, on, register, route, type Messages, type Routes } from "../ipc";
import * as lifecycle from "../lifecycle";

type Args<Key extends keyof AppMessages> = Parameters<AppMessages[Key]>;
export function registerAppIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, appQueryChannels, {
        getInfo: route(typia.createAssert<Parameters<AppQueries["getInfo"]>>(invalid), () => ({
            version: app.getVersion(),
            electron: process.versions.electron,
            chromium: process.versions.chrome,
            node: process.versions.node,
            v8: process.versions.v8,
            os: { type: osType(), arch: machine(), version: process.getSystemVersion() }
        }))
    } satisfies Routes<AppQueries>);
    register(contents, appChannels, {
        openDevTools: route(typia.createAssert<Args<"openDevTools">>(invalid), () => contents.openDevTools({ mode: "detach" })),
        setFrameColors: route(typia.createAssert<Args<"setFrameColors">>(invalid), (color, symbolColor) => {
            if (process.platform !== "darwin" && !window.isDestroyed()) window.setTitleBarOverlay({ color, symbolColor });
        }),
        editorStarted: route(typia.createAssert<Args<"editorStarted">>(invalid), () => lifecycle.editorStarted(contents)),
        beforeQuitResult: route(typia.createAssert<Args<"beforeQuitResult">>(invalid), (id, blocked) => lifecycle.saveResult(contents, id, blocked))
    } satisfies Messages<AppMessages>, on);
}