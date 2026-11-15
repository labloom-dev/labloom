import { app, dialog, type BrowserWindow, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { appChannels } from "../shared/ipc";
import { on } from "./ipc";
import * as settings from "./settings/store";
import * as session from "./session";
import { t } from "./ui/i18n";

type Runtime = { app: Pick<typeof app, "on" | "removeListener" | "quit">; dialog: Pick<typeof dialog, "showMessageBox">; platform: NodeJS.Platform };
type Pending = { id: string; result: Promise<boolean>; finish(block: boolean): void };
type Binding = { window: BrowserWindow; started: boolean; allowClose: boolean; pending: Pending | null };
let runtime: Runtime;
let binding: Binding | null = null;
let allowQuit = false, quitRequested = false;
let operation: Promise<void> | null = null;
let previousApp: Runtime["app"] | undefined;
export function initialize(options: Partial<Runtime> = {}): void {
    previousApp?.removeListener("before-quit", beforeQuit);
    binding?.pending?.finish(true);
    binding = null; allowQuit = quitRequested = false; operation = null;
    runtime = { app, dialog, platform: process.platform, ...options };
    previousApp = runtime.app;
    runtime.app.on("before-quit", beforeQuit);
}
function beforeQuit(event: { preventDefault(): void }): void {
    if (allowQuit) return;
    event.preventDefault();
    quitRequested = true;
    attempt();
}
function reveal(current: Binding | null): void {
    if (!current || current.window.isDestroyed()) return;
    if (current.window.isMinimized()) current.window.restore();
    current.window.show(); current.window.focus();
    if (!current.window.webContents.isDestroyed()) current.window.webContents.focus();
}
function requestSave(current: Binding | null): Promise<boolean> {
    if (!current || !current.started || !session.ready()) return Promise.resolve(false);
    if (current.pending) return current.pending.result;
    const window = current.window, contents = window.webContents;
    if (contents.isDestroyed() || contents.isLoadingMainFrame()) return Promise.resolve(true);
    const id = randomUUID();
    let resolve!: (blocked: boolean) => void;
    const result = new Promise<boolean>(finish => resolve = finish);
    let settled = false;
    const pending: Pending = {
        id, result, finish(block) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (current.pending === pending) current.pending = null;
            resolve(block);
        }
    };
    const timer = setTimeout(() => {
        if (window.isDestroyed()) {
            pending.finish(true); return;
        }
        void runtime.dialog.showMessageBox(window, {
            type: "warning", message: t("dialog.closeTimeout"), detail: t("dialog.closeTimeoutDetail"),
            buttons: [t("dialog.stay"), t("dialog.closeAnyway")], defaultId: 0, cancelId: 0
        }).then(({ response }) => pending.finish(response !== 1), error => {
            console.error(error); pending.finish(true);
        });
    }, 15000);
    current.pending = pending;
    try {
        contents.send(appChannels.beforeQuit, id);
    }
    catch (error) {
        console.error(error); pending.finish(true);
    }
    return result;
}
function attempt(): void {
    if (operation) return;
    const current = binding;
    operation = requestSave(current).then(async blocked => {
        if (blocked) {
            reveal(current); return;
        }
        if (current && !current.window.isDestroyed()) current.window.hide();
        try {
            const saved = await settings.flush(settings.get().settingsRevision);
            if (!saved.success) console.error("Could not save settings before exit", saved.error);
        }
        catch (error) {
            console.error("Could not save settings before exit", error);
        }
        try {
            const quitting = quitRequested || runtime.platform !== "darwin";
            if (quitting) {
                session.close();
                allowQuit = true;
                runtime.app.quit();
            }
            else if (current && !current.window.isDestroyed()) {
                current.allowClose = true;
                current.window.close();
            }
        }
        catch (error) {
            reveal(current); console.error("Could not prepare application exit", error);
        }
    }).catch(error => {
        reveal(current); console.error(error);
    }).finally(() => {
        operation = null; quitRequested = false;
    });
}
export function editorStarted(contents: WebContents): void {
    if (binding?.window.webContents === contents) binding.started = true;
}
export function registerWindowLifecycle(window: BrowserWindow): void {
    const current: Binding = { window, started: false, allowClose: false, pending: null };
    binding = current;
    const contents = window.webContents;
    on(contents, appChannels.beforeQuitResult, (id, block) => {
        if (id === current.pending?.id) current.pending?.finish(block !== false);
    });
    contents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) current.pending?.finish(true);
    });
    contents.on("render-process-gone", () => current.pending?.finish(true));
    contents.once("destroyed", () => current.pending?.finish(true));
    contents.on("will-prevent-unload", event => {
        if (current.allowClose || allowQuit) event.preventDefault();
    });
    window.on("close", event => {
        if (current.allowClose || allowQuit) return;
        event.preventDefault();
        attempt();
    });
    window.once("closed", () => {
        current.pending?.finish(true);
        if (binding === current) binding = null;
    });
}