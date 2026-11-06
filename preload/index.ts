import { contextBridge, ipcRenderer } from "electron";
import type { AppAPI } from "../shared/app";
import { appChannels, feedChannels, startupChannels } from "../shared/ipc";

// The renderer only gets this typed bridge, never ipcRenderer itself.
const api: AppAPI = {
    openDevTools: () => ipcRenderer.send(appChannels.openDevTools),
    feed: {
        getState: query => ipcRenderer.invoke(feedChannels.getState, query),
        saveSource: source => ipcRenderer.invoke(feedChannels.saveSource, source),
        removeSource: id => ipcRenderer.invoke(feedChannels.removeSource, id),
        refresh: sourceId => ipcRenderer.invoke(feedChannels.refresh, sourceId),
        setRead: (id, isRead) => ipcRenderer.invoke(feedChannels.setRead, id, isRead),
        openItem: id => ipcRenderer.invoke(feedChannels.openItem, id)
    },
    startup: {
        getState: () => ipcRenderer.invoke(startupChannels.getState),
        chooseWorkspace: action => ipcRenderer.invoke(startupChannels.chooseWorkspace, action),
        retry: () => ipcRenderer.invoke(startupChannels.retry)
    }
};

contextBridge.exposeInMainWorld("api", api);