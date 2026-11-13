import type { Changed, KnowledgeChange } from "../../../shared/types/content";
import { LabloomError } from "../../../shared/failure";

// A list query can gain new members. A document only depends on its own page and displayed blocks.
export type TabChange = Changed & Pick<KnowledgeChange, "kinds" | "summaryPages" | "definition" | "notices">;
export type TabView = {
    intersection(change: TabChange): string[];
    read(ids: string[], initial: boolean): Promise<void>;
    pending(): TabChange | "unknown" | undefined;
    flush(): Promise<boolean>;
    ownChanges?: boolean;
    ready?(): void;
};
type Visit = {
    view: TabView;
    ids: Set<string>;
    initial: boolean;
    blocked: boolean;
    reading?: Promise<boolean>;
};
type Departure = { id: string; changes: TabChange | "unknown"; done: Promise<boolean>; failed: boolean };

export class TabVisits {
    private readonly views = new Map<string, Visit>();
    private readonly departures = new Set<Departure>();
    private focused: string | null = null;
    constructor(
        private readonly lock: (id: string, locked: boolean) => void,
        private readonly error: (problem: unknown) => void,
        private readonly failed?: (id: string) => void
    ) {}

    register(id: string, view: TabView): () => void {
        const visit: Visit = { view, ids: new Set(), initial: true, blocked: false };
        this.views.set(id, visit);
        void this.enter(id, visit);
        return () => {
            if (this.views.get(id) === visit) {
                this.views.delete(id);
                this.lock(id, false);
            }
        };
    }

    changed(change: KnowledgeChange): void {
        for (const [id, visit] of this.views) {
            if (id === change.sourceTab && !visit.view.ownChanges && !change.definition) continue;
            for (const object of visit.view.intersection(change)) visit.ids.add(object);
            if (id === this.focused && visit.ids.size) void this.enter(id, visit);
        }
    }

    refresh(id: string): void {
        const visit = this.views.get(id);
        if (!visit) return;
        visit.initial = true;
        if (this.focused === id) void this.enter(id, visit);
    }

    focus(id: string | null): void {
        if (id === this.focused) return;
        const previous = this.focused;
        this.focused = null;
        if (previous) this.leave(previous);
        this.focused = id;
        if (id) {
            const next = this.views.get(id);
            if (next) void this.enter(id, next);
        }
    }

    private leave(id: string): void {
        const visit = this.views.get(id);
        if (!visit) return;
        const changes = visit.view.pending();
        const flush = async (): Promise<boolean> => {
            // This also orders buffered keys from a short visit A → B → C before C's read.
            if (changes && visit.reading && !await visit.reading) return false;
            return visit.view.flush();
        };
        const done = flush().catch(problem => {
            this.error(problem);
            return false;
        });
        if (!changes) return;
        const departure: Departure = { id, changes, done, failed: false };
        this.departures.add(departure);
        void done.then(ok => {
            if (ok) this.departures.delete(departure);
            else departure.failed = true;
        });
    }

    private enter(id: string, visit: Visit): Promise<boolean> | undefined {
        if (visit.reading) return visit.reading;
        // The author must be able to correct an invalid value after a failed save.
        const prior = [...this.departures].filter(d => !(d.failed && d.id === id) && (d.changes === "unknown" || visit.view.intersection(d.changes).length));
        if (!prior.length && !visit.initial && !visit.ids.size && !visit.blocked) return;
        visit.blocked = true;
        this.lock(id, true);
        const read = async (): Promise<boolean> => {
            for (const departure of prior) {
                if (!await departure.done) {
                    const source = this.views.get(departure.id);
                    if (source && !await source.view.flush()) throw new LabloomError({ kind: "page-unsaved" });
                    this.departures.delete(departure);
                }
            }
            while (this.views.get(id) === visit && (visit.initial || visit.ids.size)) {
                const ids = [...visit.ids], initial = visit.initial;
                visit.ids.clear();
                visit.initial = false;
                try {
                    await visit.view.read(ids, initial);
                }
                catch (problem) {
                    visit.initial ||= initial;
                    for (const object of ids) visit.ids.add(object);
                    throw problem;
                }
            }
            if (this.views.get(id) === visit) {
                visit.reading = undefined;
                visit.blocked = false;
                this.lock(id, false);
                visit.view.ready?.();
            }
            return true;
        };
        // Install the promise before any read can synchronously publish another change.
        visit.reading = Promise.resolve().then(read).catch(problem => {
            visit.reading = undefined;
            if (this.views.get(id) === visit) {
                this.failed?.(id);
                this.error(problem);
            }
            return false;
        });
        return visit.reading;
    }

    async settled(id: string): Promise<boolean> {
        const visit = this.views.get(id);
        return !visit || (await this.enter(id, visit) ?? true);
    }
}