import type { TabChange, TabView } from "../Tab/visits";

/** Several page sessions participate in one tab's existing visit boundary. */
export class SessionViews implements TabView {
    private readonly views = new Map<TabView, boolean>();
    add(view: TabView): () => void {
        this.views.set(view, false);
        return () => this.views.delete(view);
    }
    get size(): number {
        return this.views.size;
    }
    intersection(change: TabChange): string[] {
        return [...new Set([...this.views.keys()].flatMap(view => view.intersection(change)))];
    }
    pending(): TabChange | "unknown" | undefined {
        const changes = [...this.views.keys()].map(view => view.pending()).filter(value => value !== undefined);
        if (changes.length > 1 || changes.includes("unknown")) return "unknown";
        return changes[0];
    }
    async flush(): Promise<boolean> {
        // Sequential commits preserve the single tab history's order across pages.
        for (const view of this.views.keys()) if (!await view.flush()) return false;
        return true;
    }
    async read(ids: string[], _initial: boolean): Promise<void> {
        for (const [view, initialized] of this.views) {
            await view.read(ids, !initialized);
            if (this.views.has(view)) this.views.set(view, true);
        }
    }
    ready(): void {
        for (const view of this.views.keys()) view.ready?.();
    }
}

export const sessionKey = (tabId: string, pageId: string): string => JSON.stringify([tabId, pageId]);