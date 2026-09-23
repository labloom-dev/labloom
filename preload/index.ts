import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { AppAPI } from "../shared/types/startup";

// Custom APIs for renderer
const api: AppAPI = {
    startup: {
        getState: () => ipcRenderer.invoke("startup:get-state"),
        chooseWorkspace: action => ipcRenderer.invoke("startup:choose-workspace", action),
        retry: () => ipcRenderer.invoke("startup:retry")
    }
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld("electron", electronAPI);
        contextBridge.exposeInMainWorld("api", api);
    }
    catch (error) {
        console.error(error);
    }
}
else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI;
    // @ts-ignore (define in dts)
    window.api = api;
}