import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import icon from "../../resources/labloom-2x-trs.png?asset";
import { minWindowWidth, minWindowHeight } from "../../shared/settings/defaults";
import type { LogFile } from "../logging";
import * as settings from "../settings/store";
import * as lifecycle from "../lifecycle";
import { registerIPCs } from "../register";
import { attach } from "./windowFrame";

let mainWindowRef: BrowserWindow | undefined;
function openExternal(url: string): void {
    // Pages may only hand web links to the system browser, never file: or application protocols.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(console.error);
}


export function createWindow(applicationLog: LogFile | null): void {
    const bounds = settings.get().settings.window;
    const mainWindow = new BrowserWindow({
        ...(process.platform !== "darwin" ? {
            titleBarOverlay: { height: 32 }
        } : {}),
        width: bounds.width,
        height: bounds.height,
        minWidth: minWindowWidth,
        minHeight: minWindowHeight,
        show: false,
        autoHideMenuBar: true,
        titleBarStyle: "hidden",
        icon,
        webPreferences: {
            preload: join(__dirname, "../preload/index.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    // Account for Windows frame rounding before remembering normal window bounds.
    let width = bounds.width, height = bounds.height;
    for (let attempt = 0; attempt < 3; attempt++) {
        const actual = mainWindow.getBounds();
        if (actual.width === bounds.width && actual.height === bounds.height) break;
        width = Math.max(minWindowWidth, width + bounds.width - actual.width);
        height = Math.max(minWindowHeight, height + bounds.height - actual.height);
        mainWindow.setSize(width, height);
    }
    mainWindowRef = mainWindow;
    mainWindow.once("closed", () => {
        if (mainWindowRef === mainWindow) mainWindowRef = undefined;
    });
    const contents = mainWindow.webContents;

    contents.on("console-message", details => {
        applicationLog?.record(`renderer ${details.level} ${details.sourceId}:${details.lineNumber}`, details.message);
    });
    contents.on("render-process-gone", (_event, details) => applicationLog?.record("Renderer exited", details));
    const rememberWindow = attach(mainWindow);
    registerIPCs(mainWindow, rememberWindow);
    lifecycle.registerWindowLifecycle(mainWindow);
    if (bounds.maximized) mainWindow.maximize();

    mainWindow.once("ready-to-show", () => {
        const [, windowHeight] = mainWindow.getSize();
        const [, contentHeight] = mainWindow.getContentSize();
        mainWindow.setMinimumSize(minWindowWidth, minWindowHeight + windowHeight - contentHeight);
        mainWindow.show();
    });

    contents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
        if (url !== contents.getURL()) {
            event.preventDefault();
            openExternal(url);
        }
    });

    contents.on("before-input-event", (event, input) => {
        const command = input.control || input.meta;
        // Disable native reload/close shortcuts while keeping page key events.
        contents.setIgnoreMenuShortcuts(
            command && (input.code === "KeyR" || input.code === "KeyW")
        );

        if (input.code === "F11") {
            event.preventDefault();
            return;
        }
        if (input.type !== "keyDown" || input.isComposing) return;

        if (input.code === "F12") {
            event.preventDefault();
            if (!input.isAutoRepeat) {
                if (!app.isPackaged && !contents.isDevToolsOpened()) {
                    contents.openDevTools({ mode: "undocked" });
                }
                else contents.toggleDevTools();
            }
            return;
        }

        if (
            (command && (input.code === "Minus" || (input.code === "Equal" && input.shift)))
            || (app.isPackaged && input.code === "KeyI" && ((input.control && input.shift) || (input.meta && input.alt)))
        ) {
            event.preventDefault();
        }
    });

    // HMR support, do not remove
    if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    else mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}


export function show(applicationLog: LogFile | null): void {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) createWindow(applicationLog);
    const window = mainWindowRef!;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
}