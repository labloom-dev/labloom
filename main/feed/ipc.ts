import { net, shell, type WebContents } from "electron";
import type { FeedQuery, FeedSourceInput } from "../../shared/types/feed";
import { feedChannels } from "../../shared/ipc";
import { handle } from "../ipc";
import type { Startup } from "../startup/startup";
import { fetchFeed } from "./parser";
import { FeedService } from "./service";

// Shared by every window, so refreshes of one source never run twice.
let service: FeedService | undefined;

export function registerFeedIPCs(contents: WebContents, startup: Startup): void {
    function feed(): FeedService {
        service ??= new FeedService(startup.getDatabase(), url => fetchFeed(url, net.fetch));
        return service;
    }

    // FeedService validates the shape of each argument itself.
    handle(contents, feedChannels.getState, query => feed().getState(query as FeedQuery));
    handle(contents, feedChannels.saveSource, source => feed().saveSource(source as FeedSourceInput));
    handle(contents, feedChannels.removeSource, id => feed().removeSource(id as string));
    handle(contents, feedChannels.refresh, sourceId => feed().refresh(sourceId as string | undefined));
    handle(contents, feedChannels.setRead, (id, isRead) => feed().setRead(id as string, isRead as boolean));
    handle(contents, feedChannels.openItem, id => shell.openExternal(feed().itemURL(id as string)));
}