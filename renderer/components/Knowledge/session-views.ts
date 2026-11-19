import { type KnowledgeChange } from "../../../shared/types/content";
import { type TabView } from "../Tab/visits";

/** Several page sessions participate in one tab's existing visit boundary. */
export class SessionViews implements TabView {
    private readonly views = new Map<TabView, { initialized: boolean; ids: Set<string> }>();
    add(view: TabView): () => void {
        this.views.set(view, { initialized: false, ids: new Set() });
        return () => this.views.delete(view);
    }
    get size(): number {
        return this.views.size;
    }
    changed(change: KnowledgeChange): string[] {
        const affected = new Set<string>();
        for (const [view, state] of this.views) {
            const ids = view.changed(change);
            for (const id of ids) {
                state.ids.add(id);
                affected.add(id);
            }
        }
        return [...affected];
    }
    pending(): boolean {
        return [...this.views.keys()].some(view => view.pending?.());
    }
    async flush(): Promise<boolean> {
        // Flush the paper and its annotation buffers in the order the views opened.
        for (const view of this.views.keys()) if (view.flush && !await view.flush()) return false;
        return true;
    }
    async read(): Promise<void> {
        for (const [view, state] of this.views) {
            if (state.initialized && !state.ids.size) continue;
            const ids = [...state.ids];
            state.ids.clear();
            try {
                await view.read(ids, !state.initialized);
                state.initialized = true;
            }
            catch (error) {
                for (const id of ids) state.ids.add(id);
                throw error;
            }
        }
    }
    ready(): void {
        for (const view of this.views.keys()) view.ready?.();
    }
}

export const sessionKey = (tabId: string, pageId: string): string => JSON.stringify([tabId, pageId]);