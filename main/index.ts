import { app, BrowserWindow, net } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { captureConsole, LogDirectory } from "./logging";
import { developmentDataPath } from "./storage/app";
import * as startup from "./startup/startup";
import * as session from "./session";
import * as settingsEffects from "./settings/effects";
import * as lifecycle from "./lifecycle";
import * as windows from "./ui/window";
import * as reminders from "./ui/reminders";

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
    reminders.initialize();

    app.whenReady().then(() => {
        app.setAppUserModelId("dev.labloom.app");
        startup.restore();
        windows.createWindow(applicationLog);
    });


    app.on("second-instance", () => {
        void app.whenReady().then(() => windows.show(applicationLog));
    });

    // If there are no open windows, create a new one on activation.
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) windows.createWindow(applicationLog);
    });

    // Close the app when all windows are closed, except on macOS. There, it's common for applications and their menu bar to stay active until the user quits explicitly with Cmd + Q.
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}