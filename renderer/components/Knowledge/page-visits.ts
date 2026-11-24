import { visits } from "../Tab/activity.svelte";
import { type TabView } from "../Tab/visits";
import { SessionViews } from "./session-views";

const groups = new Map<string, { views: SessionViews; release: () => void }>();
export function registerPageView(tabId: string, view: TabView): (() => void) & { refresh(): void } {
    let group = groups.get(tabId);
    const views = group?.views ?? new SessionViews();
    const remove = views.add(view);
    if (group) visits.refresh(tabId);
    else {
        group = { views, release: visits.register(tabId, views) };
        groups.set(tabId, group);
    }
    return Object.assign(() => {
        remove();
        if (!views.size) {
            group.release();
            groups.delete(tabId);
        }
    }, { refresh() {
        views.invalidate(view);
        visits.refresh(tabId);
    } });
}
export function registerList(tabId: string, changed: TabView["changed"], read: TabView["read"]): () => void {
    return visits.register(tabId, { changed, read });
}