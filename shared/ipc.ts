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
    resources: "knowledge:resources",
    readFile: "knowledge:readFile",
    getAnchor: "knowledge:getAnchor",
    unlockPDF: "knowledge:unlockPDF",
    changeHighlight: "knowledge:changeHighlight",
    position: "knowledge:position",
    highlight: "knowledge:highlight",
    removeHighlight: "knowledge:removeHighlight",
    annotate: "knowledge:annotate",
    notices: "knowledge:notices",
    readNotice: "knowledge:readNotice"
} as const;
export const knowledgeChanged = "knowledge:changed";
export const saveBeforeClose = "knowledge:before-close";
export const saveBeforeCloseReply = "knowledge:close-reply";

export const appearanceChannels = {
    get: "appearance:get",
    save: "appearance:save"
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
    setRead: "feed:set-read",
    openItem: "feed:open-item"
} as const;