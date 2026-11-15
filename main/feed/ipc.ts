import { type BrowserWindow, shell } from "electron";
import type { FeedQuery, FeedSourceAction, FeedSourceInput } from "../../shared/types/feed";
import { feedChannels } from "../../shared/ipc";
import { handle } from "../ipc";
import * as feed from "./service";

export function registerFeedIPCs(window: BrowserWindow): void {
    const contents = window.webContents;

    // The subscription module validates the shape of each argument itself.
    handle(contents, feedChannels.getState, query => feed.getState(query as FeedQuery));
    handle(contents, feedChannels.getItem, id => feed.getItem(id as string));
    handle(contents, feedChannels.saveSource, source => feed.saveSource(source as FeedSourceInput));
    handle(contents, feedChannels.setSourceStatus, (id, action) => feed.setSourceStatus(id as string, action as FeedSourceAction));
    handle(contents, feedChannels.refresh, sourceId => feed.refresh(sourceId as string | undefined));
    handle(contents, feedChannels.setRead, (id, isRead) => feed.setRead(id as string, isRead as boolean));
    handle(contents, feedChannels.markAllRead, sourceId => feed.markAllRead(sourceId as string | undefined));
    handle(contents, feedChannels.setPosition, (id, progress) => feed.setPosition(id as string, progress as number));
    handle(contents, feedChannels.setKeywords, keywords => feed.setKeywords(keywords as string[]));
    handle(contents, feedChannels.importItem, (id, replace) => feed.importItem(id as string, replace === true));
    handle(contents, feedChannels.fetchPDF, id => feed.fetchPDF(id as string));
    handle(contents, feedChannels.openItem, id => shell.openExternal(feed.itemURL(id as string)));

}