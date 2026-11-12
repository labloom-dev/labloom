import { app, BrowserWindow, net, shell } from "electron";
import type { FeedQuery, FeedSourceAction, FeedSourceInput } from "../../shared/types/feed";
import { feedChanged, feedChannels } from "../../shared/ipc";
import { handle } from "../ipc";
import type { Startup } from "../startup/startup";
import { fetchFeed } from "./parser";
import { FeedService, type FeedLibrary } from "./service";

// Sources are checked for a due refresh this often; each source keeps its own interval.
const checkInterval = 30 * 1000;

// Shared by every window, so refreshes of one source never run twice.
let service: FeedService | undefined;
let checking = false;

export function registerFeedIPCs(window: BrowserWindow, startup: Startup, library: FeedLibrary): void {
    const contents = window.webContents;
    function feed(): FeedService {
        if (!service) {
            service = new FeedService(startup.getDatabase(), request => fetchFeed(request, net.fetch), library);
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
    handle(contents, feedChannels.openItem, id => shell.openExternal(feed().itemURL(id as string)));

    if (checking) return;
    checking = true;

    // Sources that fell due while the application was closed are fetched on the first check.
    const check = (): void => {
        if (startup.state.status !== "ready") return;
        feed().refreshDue().catch(error => console.error("Feed refresh failed", error));
    };
    const timer = setInterval(check, checkInterval);
    const first = setTimeout(check, 3000);
    // Neither timer should keep test or benchmark processes alive.
    timer.unref();
    first.unref();
    // Normal app shutdown clears both; app.exit() destroys the whole runtime.
    app.once("quit", () => {
        clearInterval(timer);
        clearTimeout(first);
    });
}