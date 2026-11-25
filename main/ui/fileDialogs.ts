import { dialog, type BrowserWindow } from "electron";
import type { StartupState, WorkspaceAction } from "../../shared/types/startup";
import * as startup from "../startup/startup";
import { t } from "./i18n";

export async function selectPDF(window: BrowserWindow): Promise<string[]> {
    const result = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"], filters: [{ name: t("dialog.pdfFilter"), extensions: ["pdf"] }] });
    return result.canceled ? [] : result.filePaths;
}
// One dialog at a time prevents repeated clicks in the current window.
let choosingWorkspace = false;

export function retryWorkspace(): StartupState {
    return choosingWorkspace ? startup.state : startup.restore();
}
export async function chooseWorkspace(window: BrowserWindow, action: WorkspaceAction): Promise<StartupState> {
    if (choosingWorkspace || startup.state.status === "ready" || !startup.state.canChoose) return startup.state;
    choosingWorkspace = true;
    try {
        const result = await dialog.showOpenDialog(window, {
            title: t(action === "create" ? "startup.createTitle" : "startup.openTitle"),
            buttonLabel: t(action === "create" ? "startup.createHere" : "startup.open"),
            defaultPath: startup.state.lastWorkspace?.path,
            properties: ["openDirectory", "createDirectory"]
        });
        if (result.canceled || !result.filePaths[0] || window.isDestroyed()) return startup.state;
        return startup.choose(result.filePaths[0], action);
    }
    finally {
        choosingWorkspace = false;
    }
}