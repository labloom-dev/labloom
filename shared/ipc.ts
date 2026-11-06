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
    setRead: "feed:set-read",
    openItem: "feed:open-item"
} as const;