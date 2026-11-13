import { BrowserWindow, net, shell } from "electron";
import type { FeedQuery, FeedSourceAction, FeedSourceInput } from "../../shared/types/feed";
import { feedChanged, feedChannels, knowledgeChanged } from "../../shared/ipc";
import { handle } from "../ipc";
import type { Startup } from "../startup/startup";
import { fetchFeed } from "./parser";
import { FeedService, type FeedLibrary } from "./service";

// Every window uses this service; native-connection guards keep tests and reopened workspaces isolated.
let service: FeedService | undefined;

export function registerFeedIPCs(window: BrowserWindow, startup: Startup, library: FeedLibrary): () => FeedService {
    const contents = window.webContents;
    function feed(): FeedService {
        if (!service || service.knowledge.sql !== startup.getDatabase().$client) {
            service = new FeedService(startup.getDatabase(), request => fetchFeed(request, net.fetch), library);
            service.knowledge.onChanged = change => {
                for (const open of BrowserWindow.getAllWindows()) if (!open.isDestroyed()) open.webContents.send(knowledgeChanged, change);
            };
            // Views coalesce bursts themselves; every window reads the same workspace.
            service.onChanged = () => {
                for (const open of BrowserWindow.getAllWindows()) if (!open.isDestroyed()) open.webContents.send(feedChanged);
            };
        }
        return service;
    }

    // FeedService validates the shape of each argument itself.
    handle(contents, feedChannels.getState, query => feed().getState(query as FeedQuery));
    handle(contents, feedChannels.getItem, id => feed().getItem(id as string));
    handle(contents, feedChannels.saveSource, source => feed().saveSource(source as FeedSourceInput));
    handle(contents, feedChannels.setSourceStatus, (id, action) => feed().setSourceStatus(id as string, action as FeedSourceAction));
    handle(contents, feedChannels.refresh, sourceId => feed().refresh(sourceId as string | undefined));
    handle(contents, feedChannels.setRead, (id, isRead) => feed().setRead(id as string, isRead as boolean));
    handle(contents, feedChannels.markAllRead, sourceId => feed().markAllRead(sourceId as string | undefined));
    handle(contents, feedChannels.setPosition, (id, progress) => feed().setPosition(id as string, progress as number));
    handle(contents, feedChannels.setKeywords, keywords => feed().setKeywords(keywords as string[]));
    handle(contents, feedChannels.importItem, (id, replace) => feed().importItem(id as string, replace === true));
    handle(contents, feedChannels.fetchPDF, id => feed().fetchPDF(id as string));
    handle(contents, feedChannels.openItem, id => shell.openExternal(feed().itemURL(id as string)));

    return feed;
}