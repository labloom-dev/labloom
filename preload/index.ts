import { contextBridge, ipcRenderer } from "electron";
import type { AppAPI } from "../shared/app";
import { appChannels, appearanceChannels, feedChanged, feedChannels, startupChannels } from "../shared/ipc";
import { knowledgeChannels, knowledgeChanged, saveBeforeClose, saveBeforeCloseReply } from "../shared/ipc";

// The renderer only gets this typed bridge, never ipcRenderer itself.
const api: AppAPI = {
    openDevTools: () => ipcRenderer.send(appChannels.openDevTools),
    knowledge: {
        list: (...args) => ipcRenderer.invoke(knowledgeChannels.list, ...args),
        listUpdates: (...args) => ipcRenderer.invoke(knowledgeChannels.listUpdates, ...args),
        get: (...args) => ipcRenderer.invoke(knowledgeChannels.get, ...args),
        create: (...args) => ipcRenderer.invoke(knowledgeChannels.create, ...args),
        readObjects: (...args) => ipcRenderer.invoke(knowledgeChannels.readObjects, ...args),
        commitEdit: (...args) => ipcRenderer.invoke(knowledgeChannels.commitEdit, ...args),
        previewEdit: (...args) => ipcRenderer.invoke(knowledgeChannels.previewEdit, ...args),
        deleteBlock: (...args) => ipcRenderer.invoke(knowledgeChannels.deleteBlock, ...args),
        place: (...args) => ipcRenderer.invoke(knowledgeChannels.place, ...args),
        trash: (...args) => ipcRenderer.invoke(knowledgeChannels.trash, ...args),
        restore: (...args) => ipcRenderer.invoke(knowledgeChannels.restore, ...args),
        purge: (...args) => ipcRenderer.invoke(knowledgeChannels.purge, ...args),
        emptyTrash: (...args) => ipcRenderer.invoke(knowledgeChannels.emptyTrash, ...args),
        definitions: (...args) => ipcRenderer.invoke(knowledgeChannels.definitions, ...args),
        define: (...args) => ipcRenderer.invoke(knowledgeChannels.define, ...args),
        backlinks: (...args) => ipcRenderer.invoke(knowledgeChannels.backlinks, ...args),
        resolve: (...args) => ipcRenderer.invoke(knowledgeChannels.resolve, ...args),
        history: (...args) => ipcRenderer.invoke(knowledgeChannels.history, ...args),
        undo: (...args) => ipcRenderer.invoke(knowledgeChannels.undo, ...args),
        closeTab: (...args) => ipcRenderer.invoke(knowledgeChannels.closeTab, ...args),
        loadTabs: (...args) => ipcRenderer.invoke(knowledgeChannels.loadTabs, ...args),
        saveTabs: (...args) => ipcRenderer.invoke(knowledgeChannels.saveTabs, ...args),
        importPDF: (...args) => ipcRenderer.invoke(knowledgeChannels.importPDF, ...args),
        resources: (...args) => ipcRenderer.invoke(knowledgeChannels.resources, ...args),
        readFile: (...args) => ipcRenderer.invoke(knowledgeChannels.readFile, ...args),
        getAnchor: (...args) => ipcRenderer.invoke(knowledgeChannels.getAnchor, ...args),
        unlockPDF: (...args) => ipcRenderer.invoke(knowledgeChannels.unlockPDF, ...args),
        changeHighlight: (...args) => ipcRenderer.invoke(knowledgeChannels.changeHighlight, ...args),
        position: (...args) => ipcRenderer.invoke(knowledgeChannels.position, ...args),
        highlight: (...args) => ipcRenderer.invoke(knowledgeChannels.highlight, ...args),
        removeHighlight: (...args) => ipcRenderer.invoke(knowledgeChannels.removeHighlight, ...args),
        annotate: (...args) => ipcRenderer.invoke(knowledgeChannels.annotate, ...args),
        notices: (...args) => ipcRenderer.invoke(knowledgeChannels.notices, ...args),
        readNotice: (...args) => ipcRenderer.invoke(knowledgeChannels.readNotice, ...args),
        onChanged: listener => {
            const handler = (_event: unknown, change: Parameters<typeof listener>[0]): void => listener(change);
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
        getItem: id => ipcRenderer.invoke(feedChannels.getItem, id),
        saveSource: source => ipcRenderer.invoke(feedChannels.saveSource, source),
        setSourceStatus: (id, action) => ipcRenderer.invoke(feedChannels.setSourceStatus, id, action),
        refresh: sourceId => ipcRenderer.invoke(feedChannels.refresh, sourceId),
        setRead: (id, isRead) => ipcRenderer.invoke(feedChannels.setRead, id, isRead),
        markAllRead: sourceId => ipcRenderer.invoke(feedChannels.markAllRead, sourceId),
        setPosition: (id, progress) => ipcRenderer.invoke(feedChannels.setPosition, id, progress),
        setKeywords: keywords => ipcRenderer.invoke(feedChannels.setKeywords, keywords),
        importItem: (id, replace) => ipcRenderer.invoke(feedChannels.importItem, id, replace),
        fetchPDF: id => ipcRenderer.invoke(feedChannels.fetchPDF, id),
        openItem: id => ipcRenderer.invoke(feedChannels.openItem, id),
        onChanged: listener => {
            const handler = (): void => listener();
            ipcRenderer.on(feedChanged, handler);
            return () => ipcRenderer.removeListener(feedChanged, handler);
        }
    },
    startup: {
        getState: () => ipcRenderer.invoke(startupChannels.getState),
        chooseWorkspace: action => ipcRenderer.invoke(startupChannels.chooseWorkspace, action),
        retry: () => ipcRenderer.invoke(startupChannels.retry)
    }
};

contextBridge.exposeInMainWorld("api", api);