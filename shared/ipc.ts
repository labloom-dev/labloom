export const appChannels = {
    openDevTools: "window:open-devtools"
} as const;

export const startupChannels = {
    getState: "startup:get-state",
    retry: "startup:retry",
    chooseWorkspace: "startup:choose-workspace"
} as const;

export const feedChannels = {
    getState: "feed:get-state",
    saveSource: "feed:save-source",
    removeSource: "feed:remove-source",
    refresh: "feed:refresh",
    setReadAll: "feed:set-read-all",
    setRead: "feed:set-read",
    openItem: "feed:open-item"
} as const;

export const knowledgeChannels = {
    getSetting: "knowledge:getSetting",
    setSetting: "knowledge:setSetting",
    list: "knowledge:list",
    get: "knowledge:get",
    create: "knowledge:create",
    save: "knowledge:save",
    updateMany: "knowledge:updateMany",
    trash: "knowledge:trash",
    restore: "knowledge:restore",
    tags: "knowledge:tags",
    renameTag: "knowledge:renameTag",
    removeTag: "knowledge:removeTag",
    properties: "knowledge:properties",
    saveProperty: "knowledge:saveProperty",
    removeProperty: "knowledge:removeProperty",
    backlinks: "knowledge:backlinks",
    importFeed: "knowledge:importFeed",
    importPDF: "knowledge:importPDF",
    importDOI: "knowledge:importDOI",
    importBibTeX: "knowledge:importBibTeX",
    attachments: "knowledge:attachments",
    readAttachment: "knowledge:readAttachment",
    getPosition: "knowledge:getPosition",
    setPosition: "knowledge:setPosition",
    annotationOrigin: "knowledge:annotationOrigin",
    annotations: "knowledge:annotations",
    annotate: "knowledge:annotate",
    changeAnnotation: "knowledge:changeAnnotation",
    stats: "knowledge:stats",
    dismissReminder: "knowledge:dismissReminder",
    visit: "knowledge:visit",
    clearHistory: "knowledge:clearHistory",
    exportMarkdown: "knowledge:exportMarkdown",
    exportBibTeX: "knowledge:exportBibTeX",
    backup: "knowledge:backup",
    restoreBackup: "knowledge:restoreBackup",
    openURL: "knowledge:openURL",
    importImage: "knowledge:importImage"
} as const;

export const assistantChannels = { config: "assistant:config", configure: "assistant:configure", ask: "assistant:ask", cancel: "assistant:cancel" } as const;