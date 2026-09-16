import { app, shell, BrowserWindow, ipcMain, Menu } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../resources/labloom-2x-trs.png?asset";


function createWindow(): void {
    const mainWindow = new BrowserWindow({
        titleBarStyle: "hidden",
        ...(process.platform !== "darwin" ? { titleBarOverlay: {
            color: "#ddd",
            symbolColor: "#000000",
            height: 36
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

    mainWindow.on("ready-to-show", () => mainWindow.show());

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    mainWindow.webContents.on("before-input-event", (event, input) => {
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
    createWindow();
});


app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window, {
        escToCloseWindow: false,
        zoom: false
    });
});


//#region Menus

const filesMenu = Menu.buildFromTemplate([
    { label: "Exit", click: () => app.quit() }
]);
ipcMain.on("menu:files", (event, x: number, y: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !Number.isFinite(x) || !Number.isFinite(y)) return;
    filesMenu.popup({ window, x: Math.round(x), y: Math.round(y) });
});

//#endregion


// If there are no open windows, create a new one on activation.
app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Close the app when all windows are closed, except on macOS. There, it's common for applications and their menu bar to stay active until the user quits explicitly with Cmd + Q.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});