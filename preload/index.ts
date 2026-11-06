import { contextBridge, ipcRenderer } from "electron";
import type { AppAPI } from "../shared/app";
import { assistantChannels, appChannels, feedChannels, startupChannels, knowledgeChannels } from "../shared/ipc";

// The renderer only gets this typed bridge, never ipcRenderer itself.
const api: AppAPI = {
    openDevTools: () => ipcRenderer.send(appChannels.openDevTools),
    feed: {
        getState: query => ipcRenderer.invoke(feedChannels.getState, query),
        saveSource: source => ipcRenderer.invoke(feedChannels.saveSource, source),
        removeSource: id => ipcRenderer.invoke(feedChannels.removeSource, id),
        refresh: sourceId => ipcRenderer.invoke(feedChannels.refresh, sourceId),
        setReadAll: query => ipcRenderer.invoke(feedChannels.setReadAll, query),
        setRead: (id, isRead) => ipcRenderer.invoke(feedChannels.setRead, id, isRead),
        openItem: id => ipcRenderer.invoke(feedChannels.openItem, id)
    },
    assistant: {
        config: () => ipcRenderer.invoke(assistantChannels.config),
        configure: value => ipcRenderer.invoke(assistantChannels.configure, value),
        ask: value => ipcRenderer.invoke(assistantChannels.ask, value),
        cancel: id => ipcRenderer.invoke(assistantChannels.cancel, id)
    },
    knowledge: {
        getSetting: (...args) => ipcRenderer.invoke(knowledgeChannels.getSetting, ...args),
        setSetting: (...args) => ipcRenderer.invoke(knowledgeChannels.setSetting, ...args),
        list: (...args) => ipcRenderer.invoke(knowledgeChannels.list, ...args),
        get: (...args) => ipcRenderer.invoke(knowledgeChannels.get, ...args),
        create: (...args) => ipcRenderer.invoke(knowledgeChannels.create, ...args),
        updateMany: (...args) => ipcRenderer.invoke(knowledgeChannels.updateMany, ...args),
        save: (...args) => ipcRenderer.invoke(knowledgeChannels.save, ...args),
        trash: (...args) => ipcRenderer.invoke(knowledgeChannels.trash, ...args),
        restore: (...args) => ipcRenderer.invoke(knowledgeChannels.restore, ...args),
        tags: (...args) => ipcRenderer.invoke(knowledgeChannels.tags, ...args),
        renameTag: (...args) => ipcRenderer.invoke(knowledgeChannels.renameTag, ...args),
        removeTag: (...args) => ipcRenderer.invoke(knowledgeChannels.removeTag, ...args),
        properties: (...args) => ipcRenderer.invoke(knowledgeChannels.properties, ...args),
        saveProperty: (...args) => ipcRenderer.invoke(knowledgeChannels.saveProperty, ...args),
        removeProperty: (...args) => ipcRenderer.invoke(knowledgeChannels.removeProperty, ...args),
        backlinks: (...args) => ipcRenderer.invoke(knowledgeChannels.backlinks, ...args),
        importFeed: (...args) => ipcRenderer.invoke(knowledgeChannels.importFeed, ...args),
        importPDF: (...args) => ipcRenderer.invoke(knowledgeChannels.importPDF, ...args),
        importDOI: (...args) => ipcRenderer.invoke(knowledgeChannels.importDOI, ...args),
        importBibTeX: (...args) => ipcRenderer.invoke(knowledgeChannels.importBibTeX, ...args),
        attachments: (...args) => ipcRenderer.invoke(knowledgeChannels.attachments, ...args),
        readAttachment: (...args) => ipcRenderer.invoke(knowledgeChannels.readAttachment, ...args),
        getPosition: (...args) => ipcRenderer.invoke(knowledgeChannels.getPosition, ...args),
        setPosition: (...args) => ipcRenderer.invoke(knowledgeChannels.setPosition, ...args),
        annotationOrigin: (...args) => ipcRenderer.invoke(knowledgeChannels.annotationOrigin, ...args),
        annotations: (...args) => ipcRenderer.invoke(knowledgeChannels.annotations, ...args),
        annotate: (...args) => ipcRenderer.invoke(knowledgeChannels.annotate, ...args),
        changeAnnotation: (...args) => ipcRenderer.invoke(knowledgeChannels.changeAnnotation, ...args),
        stats: (...args) => ipcRenderer.invoke(knowledgeChannels.stats, ...args),
        dismissReminder: (...args) => ipcRenderer.invoke(knowledgeChannels.dismissReminder, ...args),
        visit: (...args) => ipcRenderer.invoke(knowledgeChannels.visit, ...args),
        clearHistory: (...args) => ipcRenderer.invoke(knowledgeChannels.clearHistory, ...args),
        exportMarkdown: (...args) => ipcRenderer.invoke(knowledgeChannels.exportMarkdown, ...args),
        exportBibTeX: (...args) => ipcRenderer.invoke(knowledgeChannels.exportBibTeX, ...args),
        backup: (...args) => ipcRenderer.invoke(knowledgeChannels.backup, ...args),
        restoreBackup: (...args) => ipcRenderer.invoke(knowledgeChannels.restoreBackup, ...args),
        openURL: (...args) => ipcRenderer.invoke(knowledgeChannels.openURL, ...args),
        importImage: (...args) => ipcRenderer.invoke(knowledgeChannels.importImage, ...args)
    },
    startup: {
        getState: () => ipcRenderer.invoke(startupChannels.getState),
        chooseWorkspace: action => ipcRenderer.invoke(startupChannels.chooseWorkspace, action),
        retry: () => ipcRenderer.invoke(startupChannels.retry)
    }
};

contextBridge.exposeInMainWorld("api", api);