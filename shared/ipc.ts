export const appChannels = {
    openDevTools: "window:open-devtools"
} as const;

export const knowledgeChannel = "knowledge:request";
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