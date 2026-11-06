import { app, shell, dialog, BrowserWindow } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import icon from "../resources/labloom-2x-trs.png?asset";
import { appChannels } from "../shared/ipc";
import { on } from "./ipc";
import { captureConsole, LogDirectory } from "./logging";
import { AppStorage, developmentDataPath } from "./storage/app";
import { Startup } from "./startup/startup";
import { registerStartupIPCs } from "./startup/ipc";
import { registerAssistantIPCs } from "./assistant/ipc";
import { registerKnowledgeIPCs } from "./knowledge/ipc";
import { registerFeedIPCs, startFeedScheduler } from "./feed/ipc";


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
            color: "#fffdf7",
            symbolColor: "#302c25",
            height: 36
        }} : {}),
        width: 1280,
        height: 860,
        backgroundColor: "#f7f3e8",
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
    registerKnowledgeIPCs(mainWindow, startup);
    registerAssistantIPCs(contents, startup);
    on(contents, appChannels.openDevTools, () => contents.openDevTools({ mode: "detach" }));

    mainWindow.once("ready-to-show", () => {
        const [, windowHeight] = mainWindow.getSize();
        const [, contentHeight] = mainWindow.getContentSize();
        mainWindow.setMinimumSize(minWindowWidth, minContentHeight + windowHeight - contentHeight);
        mainWindow.show();
    });

    contents.on("will-prevent-unload", event => {
        const choice = dialog.showMessageBoxSync(mainWindow, {
            type: "warning",
            title: "尚未保存的更改",
            message: "部分页面仍有尚未保存的更改。",
            detail: "返回编辑可继续等待保存或处理保存错误。仍然关闭会丢弃尚未保存的更改。",
            buttons: ["返回编辑", "仍然关闭"],
            defaultId: 0,
            cancelId: 0
        });
        if (choice === 1) event.preventDefault();
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
    const stopFeed = startFeedScheduler(startup);
    app.once("will-quit", stopFeed);
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