import { net, shell, type WebContents } from "electron";
import type { FeedQuery, FeedSourceInput } from "../../shared/types/feed";
import { feedChannels } from "../../shared/ipc";
import { handle } from "../ipc";
import type { Startup } from "../startup/startup";
import { fetchFeed } from "./parser";
import { FeedService } from "./service";

const services = new WeakMap<ReturnType<Startup["getDatabase"]>, FeedService>();
let suspended = false;
function feed(startup: Startup): FeedService {
    if (suspended) throw new Error("正在切换工作区，请稍后重试。");
    const database = startup.getDatabase();
    let service = services.get(database);
    if (!service) { service = new FeedService(database, url => fetchFeed(url, net.fetch)); services.set(database, service); }
    return service;
}

export async function suspendFeed(startup: Startup): Promise<() => void> {
    const service = feed(startup);
    suspended = true;
    await service.idle();
    return () => { suspended = false; };
}

export function startFeedScheduler(startup: Startup): () => void {
    let running = false;
    const tick = async (): Promise<void> => {
        if (running || suspended || startup.state.status !== "ready") return;
        running = true;
        try { await feed(startup).refreshDue(); }
        catch (error) { if (!suspended) console.error("订阅自动刷新失败", error instanceof Error ? error.message : "未知错误"); }
        finally { running = false; }
    };
    const timer = setInterval(() => { void tick(); }, 30000);
    timer.unref();
    void tick();
    return () => clearInterval(timer);
}

export function registerFeedIPCs(contents: WebContents, startup: Startup): void {
    // FeedService validates the shape of each argument itself.
    handle(contents, feedChannels.getState, query => feed(startup).getState(query as FeedQuery));
    handle(contents, feedChannels.saveSource, source => feed(startup).saveSource(source as FeedSourceInput));
    handle(contents, feedChannels.removeSource, id => feed(startup).removeSource(id as string));
    handle(contents, feedChannels.refresh, sourceId => feed(startup).refresh(sourceId as string | undefined));
    handle(contents, feedChannels.setReadAll, query => feed(startup).setReadAll(query as FeedQuery));
    handle(contents, feedChannels.setRead, (id, isRead) => feed(startup).setRead(id as string, isRead as boolean));
    handle(contents, feedChannels.openItem, id => shell.openExternal(feed(startup).itemURL(id as string)));
}