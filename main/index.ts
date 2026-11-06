import { app, shell, BrowserWindow } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import icon from "../resources/labloom-2x-trs.png?asset";
import { appChannels } from "../shared/ipc";
import { on } from "./ipc";
import { captureConsole, LogDirectory } from "./logging";
import { AppStorage, developmentDataPath } from "./storage/app";
import { Startup } from "./startup/startup";
import { registerStartupIPCs } from "./startup/ipc";
import { registerFeedIPCs } from "./feed/ipc";


// Set both paths before ready, so development also isolates Chromium state.
const dataPath = app.isPackaged
    ? app.getPath("userData")
    : developmentDataPath(app.getAppPath(), process.env["LABLOOM_PROFILE"]);
app.setPath("userData", dataPath);
const sessionPath = join(dataPath, "chromium");
mkdirSync(sessionPath, { recursive: true });
app.setPath("sessionData", sessionPath);
const logs = new LogDirectory(join(dataPath, "logs"));
const applicationLog = logs.create("application");
const restoreConsole = captureConsole(applicationLog);
applicationLog?.record("Environment", { version: app.getVersion(), platform: process.platform, arch: process.arch, versions: process.versions, dataPath });
process.on("uncaughtExceptionMonitor", error => applicationLog?.record("Uncaught exception", error));
process.once("exit", code => {
    restoreConsole();
    applicationLog?.close(`exit ${code}`);
});
const storage = new AppStorage(dataPath);
const startup = new Startup(storage);

function openExternal(url: string): void {
    // Pages may only hand web links to the system browser, never file: or application protocols.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(console.error);
}


function createWindow(): void {
    const
        minWindowWidth = 500,
        // Title bar + Sidebar buttons with no gap between groups.
        minContentHeight = 37 + 8 * 48;

    const mainWindow = new BrowserWindow({
        ...(process.platform !== "darwin" ? { titleBarOverlay: {
            color: "#ddd",
            symbolColor: "#000000",
            height: 36
        }} : {}),
        width: 960,
        height: 540,
        minWidth: minWindowWidth,
        minHeight: minContentHeight,
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
    const contents = mainWindow.webContents;

    contents.on("console-message", details => {
        applicationLog?.record(`renderer ${details.level} ${details.sourceId}:${details.lineNumber}`, details.message);
    });
    contents.on("render-process-gone", (_event, details) => applicationLog?.record("Renderer exited", details));
    registerStartupIPCs(mainWindow, startup);
    registerFeedIPCs(contents, startup);
    on(contents, appChannels.openDevTools, () => contents.openDevTools({ mode: "detach" }));

    mainWindow.once("ready-to-show", () => {
        const [, windowHeight] = mainWindow.getSize();
        const [, contentHeight] = mainWindow.getContentSize();
        mainWindow.setMinimumSize(minWindowWidth, minContentHeight + windowHeight - contentHeight);
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
        if (input.type !== "keyDown") return;

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


app.whenReady().then(() => {
    app.setAppUserModelId("dev.labloom.app");
    startup.restore();
    createWindow();
});


// If there are no open windows, create a new one on activation.
app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Close the app when all windows are closed, except on macOS. There, it's common for applications and their menu bar to stay active until the user quits explicitly with Cmd + Q.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => startup.close());