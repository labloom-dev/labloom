export const appChannels = {
    openDevTools: "window:open-devtools"
} as const;

export const knowledgeChannels = {
    list: "knowledge:list",
    listUpdates: "knowledge:listUpdates",
    get: "knowledge:get",
    readObjects: "knowledge:readObjects",
    create: "knowledge:create",
    commitEdit: "knowledge:commitEdit",
    previewEdit: "knowledge:previewEdit",
    deleteBlock: "knowledge:deleteBlock",
    place: "knowledge:place",
    trash: "knowledge:trash",
    restore: "knowledge:restore",
    purge: "knowledge:purge",
    emptyTrash: "knowledge:empty-trash",
    definitions: "knowledge:definitions",
    define: "knowledge:define",
    backlinks: "knowledge:backlinks",
    resolve: "knowledge:resolve",
    history: "knowledge:history",
    undo: "knowledge:undo",
    closeTab: "knowledge:closeTab",
    loadTabs: "knowledge:loadTabs",
    saveTabs: "knowledge:saveTabs",
    importPDF: "knowledge:importPDF",
    importFiles: "knowledge:importFiles",
    files: "knowledge:files",
    openFile: "knowledge:openFile",
    resources: "knowledge:resources",
    readFile: "knowledge:readFile",
    getAnnotation: "knowledge:getAnnotation",
    unlockPDF: "knowledge:unlockPDF",
    changeAnnotation: "knowledge:changeAnnotation",
    position: "knowledge:position",
    deleteAnnotation: "knowledge:deleteAnnotation",
    annotate: "knowledge:annotate",
    timers: "knowledge:timers",
    setTimer: "knowledge:setTimer",
    notices: "knowledge:notices",
    readNotice: "knowledge:readNotice"
} as const;
export const knowledgeChanged = "knowledge:changed";
export const saveBeforeClose = "knowledge:before-close";
export const saveBeforeCloseReply = "knowledge:close-reply";

export const appearanceChannels = {
    get: "appearance:get",
    save: "appearance:save",
    changed: "appearance:changed"
} as const;

export const startupChannels = {
    getState: "startup:get-state",
    retry: "startup:retry",
    chooseWorkspace: "startup:choose-workspace"
} as const;

export const feedChannels = {
    getState: "feed:get-state",
    getItem: "feed:get-item",
    saveSource: "feed:save-source",
    setSourceStatus: "feed:set-source-status",
    refresh: "feed:refresh",
    setRead: "feed:set-read",
    markAllRead: "feed:mark-all-read",
    setPosition: "feed:set-position",
    setKeywords: "feed:set-keywords",
    importItem: "feed:import-item",
    fetchPDF: "feed:fetch-pdf",
    openItem: "feed:open-item"
} as const;

/** Sent to every window when saved subscriptions or items change. */
export const feedChanged = "feed:changed";