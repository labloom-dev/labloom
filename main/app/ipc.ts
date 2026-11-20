import type { BrowserWindow } from "electron";
import typia from "typia";
import { appChannels, type AppMessages } from "../../shared/app/ipc";
import { invalid, on, register, route, type Messages } from "../ipc";
import * as lifecycle from "../lifecycle";

type Args<Key extends keyof AppMessages> = Parameters<AppMessages[Key]>;
export function registerAppIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, appChannels, {
        openDevTools: route(typia.createAssert<Args<"openDevTools">>(invalid), () => contents.openDevTools({ mode: "detach" })),
        setFrameColors: route(typia.createAssert<Args<"setFrameColors">>(invalid), (color, symbolColor) => {
            if (process.platform !== "darwin" && !window.isDestroyed()) window.setTitleBarOverlay({ color, symbolColor });
        }),
        editorStarted: route(typia.createAssert<Args<"editorStarted">>(invalid), () => lifecycle.editorStarted(contents)),
        beforeQuitResult: route(typia.createAssert<Args<"beforeQuitResult">>(invalid), (id, blocked) => lifecycle.saveResult(contents, id, blocked))
    } satisfies Messages<AppMessages>, on);
}