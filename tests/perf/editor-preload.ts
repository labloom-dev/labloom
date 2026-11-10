import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("prototypeBench", {
    read: () => ipcRenderer.invoke("prototype:read"),
    report: (measurement: unknown) => ipcRenderer.send("prototype:measurement", measurement)
});