import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppAPI, AppCommands, AppQueries, BridgeAPI } from "../shared/ipc";
import type { Channels, InvokeKeys } from "../shared/ipc/contract";
import { appChannels, appQueryChannels, attachmentProgress, beforeQuit, feedChanged, historyChanged, pagesChanged, settingsChanged, openReminderPage, pagesChannels, attachmentsChannels, attributesChannels, historyChannels, papersChannels, timersChannels, workspaceChannels, settingsChannels, startupChannels, feedChannels } from "../shared/ipc";

function methods<API>(channels: Record<keyof API, string>, call: (channel: string, ...args: unknown[]) => unknown): API {
    return Object.fromEntries(Object.entries<string>(channels).map(([key, channel]) => [key, (...args: unknown[]) => call(channel, ...args)])) as API;
}
function invokes<API>(channels: Channels<API>): Pick<BridgeAPI<API>, InvokeKeys<API>> {
    return methods(channels, (channel, ...args) => ipcRenderer.invoke(channel, ...args));
}
function subscribe<Args extends unknown[]>(channel: string, listener: (...args: Args) => void): () => void {
    const handler = (_event: unknown, ...args: Args): void => listener(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
}

const { beforeQuitResult, ...commands } = appChannels;
const api: BridgeAPI<AppAPI> = {
    app: {
        ...invokes<AppQueries>(appQueryChannels),
        ...methods<Omit<AppCommands, "beforeQuit">>(commands, (channel, ...args) => ipcRenderer.send(channel, ...args)),
        beforeQuit(check) {
            const listener = (_event: unknown, id: string): void => {
                Promise.resolve().then(check).then(block => ipcRenderer.send(beforeQuitResult, id, block !== false))
                    .catch(error => {
                        console.error(error); ipcRenderer.send(beforeQuitResult, id, true);
                    });
            };
            ipcRenderer.on(beforeQuit, listener);
            return () => {
                ipcRenderer.removeListener(beforeQuit, listener);
            };
        }
    },
    pages: { ...invokes<AppAPI["pages"]>(pagesChannels), onChanged: listener => subscribe(pagesChanged, listener) },
    attributes: invokes<AppAPI["attributes"]>(attributesChannels),
    history: { ...invokes<AppAPI["history"]>(historyChannels), onChanged: listener => subscribe(historyChanged, listener) },
    papers: invokes<AppAPI["papers"]>(papersChannels),
    attachments: { ...invokes<AppAPI["attachments"]>(attachmentsChannels), onTransferProgress: listener => subscribe(attachmentProgress, listener) },
    timers: { ...invokes<AppAPI["timers"]>(timersChannels), onOpenNotice: listener => subscribe(openReminderPage, listener) },
    workspace: invokes<AppAPI["workspace"]>(workspaceChannels),
    settings: { ...invokes<AppAPI["settings"]>(settingsChannels), onChanged: listener => subscribe(settingsChanged, listener) },
    startup: invokes<AppAPI["startup"]>(startupChannels),
    feed: { ...invokes<AppAPI["feed"]>(feedChannels), onChanged: listener => subscribe(feedChanged, listener) }
};

contextBridge.exposeInMainWorld("bridge", api);
contextBridge.exposeInMainWorld("getPathForFile", (file: File) => webUtils.getPathForFile(file));