import { app, shell, BrowserWindow, Notification, net } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import icon from "../resources/labloom-2x-trs.png?asset";
import { knowledgeChanged, feedChanged, appChannels } from "../shared/ipc";
import { on } from "./ipc";
import { captureConsole, LogDirectory } from "./logging";
import { developmentDataPath } from "./storage/app";
import * as startup from "./startup/startup";
import * as session from "./session";
import * as events from "./knowledge/events";
import * as settings from "./settings/store";
import * as settingsEffects from "./settings/effects";
import * as lifecycle from "./lifecycle";
import { minWindowWidth, minWindowHeight } from "../shared/settings/defaults";
import { t } from "./ui/i18n";
import { registerStartupIPCs } from "./startup/ipc";
import { registerFeedIPCs } from "./feed/ipc";
import { registerSettingsIPCs } from "./settings/ipc";
import { registerKnowledgeIPCs } from "./knowledge/ipc";


// Set both paths before ready, so development also isolates Chromium state.
const dataPath = app.isPackaged
    ? app.getPath("userData")
    : developmentDataPath(app.getAppPath(), process.env["LABLOOM_PROFILE"]);
app.setPath("userData", dataPath);
if (!app.requestSingleInstanceLock()) app.exit(0);
else {
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
    startup.initialize(dataPath);
    settingsEffects.initialize();
    lifecycle.initialize();
    session.configureNetwork((input, init) => net.fetch(input instanceof URL ? input.toString() : input, init));
    let mainWindowRef: BrowserWindow | undefined;
    events.subscribe(event => {
        const window = mainWindowRef;
        if (event.type === "reminder") {
            if (Notification.isSupported()) new Notification({ title: t("notice.reminderTitle"), body: event.body }).show();
            return;
        }
        if (!window || window.isDestroyed()) return;
        if (event.type === "knowledge") window.webContents.send(knowledgeChanged, event.change);
        else if (event.type === "feed") window.webContents.send(feedChanged);

    });

    function openExternal(url: string): void {
        // Pages may only hand web links to the system browser, never file: or application protocols.
        if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(console.error);
    }


    function createWindow(): void {
        const bounds = settings.get().settings.window;
        const mainWindow = new BrowserWindow({
            ...(process.platform !== "darwin" ? {
                titleBarOverlay: {
                    color: "#fffdf7",
                    symbolColor: "#302c25",
                    height: 32
                }
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
        registerStartupIPCs(mainWindow);
        registerKnowledgeIPCs(mainWindow);
        registerFeedIPCs(mainWindow);
        registerSettingsIPCs(mainWindow);
        lifecycle.registerWindowLifecycle(mainWindow);
        if (bounds.maximized) mainWindow.maximize();
        on(contents, appChannels.openDevTools, () => contents.openDevTools({ mode: "detach" }));

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


    app.whenReady().then(() => {
        app.setAppUserModelId("dev.labloom.app");
        startup.restore();
        createWindow();
    });


    app.on("second-instance", () => {
        void app.whenReady().then(() => {
            if (!mainWindowRef || mainWindowRef.isDestroyed()) createWindow();
            const window = mainWindowRef!;
            if (window.isMinimized()) window.restore();
            window.show(); window.focus();
        });
    });

    // If there are no open windows, create a new one on activation.
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Close the app when all windows are closed, except on macOS. There, it's common for applications and their menu bar to stay active until the user quits explicitly with Cmd + Q.
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });


}