import { app, shell, BrowserWindow, ipcMain, Menu } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../resources/labloom-2x-trs.png?asset";

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        titleBarStyle: "hidden",
        ...(process.platform !== "darwin" ? { titleBarOverlay: {
            color: "#00000000"
        }} : {}),
        width: 960,
        height: 540,
        show: false,
        autoHideMenuBar: true,
        icon,
        webPreferences: {
            preload: join(__dirname, "../preload/index.mjs"),
            sandbox: false
        }
    });

    mainWindow.on("ready-to-show", () => {
        mainWindow.show();
    });

    const devToolsWindow = new BrowserWindow({
        title: "Developer Tools",
        width: 960,
        height: 720,
        show: false,
        autoHideMenuBar: true,
        icon,
        webPreferences: { devTools: false }
    });

    mainWindow.webContents.setDevToolsWebContents(devToolsWindow.webContents);

    if (is.dev) {
        for (const window of [mainWindow, devToolsWindow]) {
            window.webContents.on("before-input-event", (event, input) => {
                if (input.type !== "keyDown" || input.code !== "F12") return;
                event.preventDefault();
                if (input.isAutoRepeat) return;
                if (devToolsWindow.isVisible()) {
                    mainWindow.webContents.closeDevTools();
                    devToolsWindow.hide();
                }
                else {
                    mainWindow.webContents.openDevTools({ mode: "detach" });
                    devToolsWindow.show();
                }
            });
        }
    }

    mainWindow.webContents.on("devtools-opened", () => {
        devToolsWindow.show();
    });
    mainWindow.webContents.on("devtools-closed", () => {
        if (!devToolsWindow.isDestroyed()) devToolsWindow.hide();
    });
    devToolsWindow.on("close", (event) => {
        event.preventDefault();
        mainWindow.webContents.closeDevTools();
        devToolsWindow.hide();
    });
    mainWindow.on("closed", () => {
        devToolsWindow.destroy();
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    // HMR support, do not remove
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    else mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
    electronApp.setAppUserModelId("dev.labloom.app");

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on("browser-window-created", (_, window) => {
        if (!is.dev) {
            optimizer.watchWindowShortcuts(window);
            return;
        }
        window.webContents.on("before-input-event", (event, input) => {
            if (input.type !== "keyDown" || !(input.control || input.meta)) return;
            if (input.code === "Minus" || (input.code === "Equal" && input.shift)) event.preventDefault();
        });
    });

    const filesMenu = Menu.buildFromTemplate([
        { label: "Exit", click: () => app.quit() }
    ]);
    ipcMain.on("menu:files", (event, x: number, y: number) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || !Number.isFinite(x) || !Number.isFinite(y)) return;
        filesMenu.popup({ window, x: Math.round(x), y: Math.round(y) });
    });

    createWindow();

    app.on("activate", () => {
        // macOS: If there are no open windows, create a new one on activation.
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});