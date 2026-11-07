import { contextBridge, ipcRenderer } from "electron";
import type { AppAPI } from "../shared/app";
import { appChannels, appearanceChannels, feedChannels, startupChannels } from "../shared/ipc";
import { knowledgeChannel, knowledgeChanged, saveBeforeClose, saveBeforeCloseReply } from "../shared/ipc";

// The renderer only gets this typed bridge, never ipcRenderer itself.
const api: AppAPI = {
    openDevTools: () => ipcRenderer.send(appChannels.openDevTools),
    knowledge: {
        list: query => ipcRenderer.invoke(knowledgeChannel, "list", query),
        get: id => ipcRenderer.invoke(knowledgeChannel, "get", id),
        create: (kind, title, initial) => ipcRenderer.invoke(knowledgeChannel, "create", kind, title, initial),
        mutate: (input, token) => ipcRenderer.invoke(knowledgeChannel, "mutate", input, token),
        definitions: () => ipcRenderer.invoke(knowledgeChannel, "definitions"),
        define: (id, value, token) => ipcRenderer.invoke(knowledgeChannel, "define", id, value, token),
        backlinks: id => ipcRenderer.invoke(knowledgeChannel, "backlinks", id),
        resolve: target => ipcRenderer.invoke(knowledgeChannel, "resolve", target),
        history: id => ipcRenderer.invoke(knowledgeChannel, "history", id),
        undo: (id, direction, branch) => ipcRenderer.invoke(knowledgeChannel, "undo", id, direction, branch),
        closeTab: id => ipcRenderer.invoke(knowledgeChannel, "closeTab", id),
        loadTabs: () => ipcRenderer.invoke(knowledgeChannel, "loadTabs"),
        saveTabs: value => ipcRenderer.invoke(knowledgeChannel, "saveTabs", value),
        onChanged: listener => {
            const handler = (): void => listener();
            ipcRenderer.on(knowledgeChanged, handler);
            return () => ipcRenderer.removeListener(knowledgeChanged, handler);
        },
        onCloseRequested: listener => {
            const handler = (_event: unknown, nonce: string): void => {
                void listener().then(saved => ipcRenderer.send(saveBeforeCloseReply, nonce, saved), () => ipcRenderer.send(saveBeforeCloseReply, nonce, false));
            };
            ipcRenderer.on(saveBeforeClose, handler);
            return () => ipcRenderer.removeListener(saveBeforeClose, handler);
        }
    },
    appearance: {
        get: () => ipcRenderer.invoke(appearanceChannels.get),
        save: value => ipcRenderer.invoke(appearanceChannels.save, value)
    },
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