import { app, shell, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../resources/labloom-2x-trs.png?asset";
import { AppStorage, developmentDataPath } from "./storage/app";
import { Startup } from "./startup";


// Set both paths before ready, so development also isolates Chromium state.
const dataPath = app.isPackaged
    ? app.getPath("userData")
    : developmentDataPath(app.getAppPath(), process.env["LABLOOM_PROFILE"]);
const storage = new AppStorage(dataPath);
app.setPath("userData", dataPath);
const sessionPath = join(dataPath, "chromium");
mkdirSync(sessionPath, { recursive: true });
app.setPath("sessionData", sessionPath);
const startup = new Startup(storage);
let choosingWorkspace = false;

function startupWindow(event: IpcMainInvokeEvent): BrowserWindow {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error("无效的启动请求。");
    return window;
}

ipcMain.handle("startup:get-state", event => {
    startupWindow(event);
    return startup.state;
});

ipcMain.handle("startup:retry", event => {
    startupWindow(event);
    return choosingWorkspace ? startup.state : startup.restore();
});

ipcMain.handle("startup:choose-workspace", async (event, action: unknown) => {
    const window = startupWindow(event);
    if (action !== "create" && action !== "open") throw new Error("无效的工作区操作。");
    if (choosingWorkspace || startup.state.status === "ready" || !startup.state.canChoose) return startup.state;
    choosingWorkspace = true;
    try {
        const result = await dialog.showOpenDialog(window, {
            title: action === "create" ? "选择空文件夹，创建工作区" : "选择已有工作区",
            buttonLabel: action === "create" ? "在此创建" : "打开工作区",
            defaultPath: startup.state.lastWorkspace?.path,
            properties: ["openDirectory", "createDirectory"]
        });
        if (result.canceled || !result.filePaths[0] || window.isDestroyed()) return startup.state;
        return startup.choose(result.filePaths[0], action);
    }
    finally {
        choosingWorkspace = false;
    }
});


function createWindow(): void {
    const
        minWindowWidth = 500,
        // Title bar + Sidebar buttons with no gap between groups.
        minContentHeight = 37 + 8 * 48;

    const mainWindow = new BrowserWindow({
        titleBarStyle: "hidden",
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
        icon,
        webPreferences: {
            preload: join(__dirname, "../preload/index.mjs"),
            sandbox: false
        }
    });

    mainWindow.once("ready-to-show", () => {
        const [, windowHeight] = mainWindow.getSize();
        const [, contentHeight] = mainWindow.getContentSize();
        mainWindow.setMinimumSize(minWindowWidth, minContentHeight + windowHeight - contentHeight);
        mainWindow.show();
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    mainWindow.webContents.ipc.on("window:open-devtools", event => {
        if (event.senderFrame !== mainWindow.webContents.mainFrame) return;
        mainWindow.webContents.openDevTools({ mode: "detach" });
    });

    mainWindow.webContents.on("before-input-event", (event, input) => {
        // The toolkit only handles F12 in development.
        if (!is.dev && input.type === "keyDown" && input.code === "F12") {
            event.preventDefault();
            if (!input.isAutoRepeat) mainWindow.webContents.toggleDevTools();
            return;
        }

        if (
            (input.control && input.key === "r")
         || (input.control && input.shift && input.key.toLowerCase() === "r")
         || (input.control && input.key === "w")
         || (input.key === "F11")
        ) {
            console.log("dwq");
            event.preventDefault();
        }
    });

    // HMR support, do not remove
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    else mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}


app.whenReady().then(() => {
    electronApp.setAppUserModelId("dev.labloom.app");
    startup.restore();
    createWindow();
});


app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window, {
        escToCloseWindow: false,
        zoom: false
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

app.on("will-quit", () => startup.close());