import { dialog, type BrowserWindow } from "electron";
import { startupChannels } from "../../shared/ipc";
import { handle } from "../ipc";
import type { Startup } from "./startup";

// One folder dialog at a time across windows, since they share one startup state.
let choosingWorkspace = false;

export function registerStartupIPCs(window: BrowserWindow, startup: Startup): void {
    const contents = window.webContents;
    handle(contents, startupChannels.getState, () => startup.state);
    handle(contents, startupChannels.retry, () => choosingWorkspace ? startup.state : startup.restore());
    handle(contents, startupChannels.chooseWorkspace, async action => {
        if (action !== "create" && action !== "open") throw new Error("Invalid workspace action.");
        if (choosingWorkspace || startup.state.status === "ready" || !startup.state.canChoose) return startup.state;
        choosingWorkspace = true;
        try {
            const result = await dialog.showOpenDialog(window, {
                title: action === "create" ? "选择一个空文件夹来创建工作区" : "选择已有的工作区",
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
}