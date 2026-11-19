import { type KnowledgeChange } from "../../../shared/types/content";
import { pendingWrites } from "../Knowledge/write-tracker";
import { LabloomError } from "../../../shared/failure";

export type TabView = {
    changed(change: KnowledgeChange): string[];
    read(ids: string[], initial: boolean): Promise<void>;
    pending?(): boolean;
    flush?(): Promise<boolean>;
    ready?(): void;
};
type Visit = {
    view: TabView;
    ids: Set<string>;
    initial: boolean;
    blocked: boolean;
    reading?: Promise<boolean>;
};
type Departure = { id: string; done: Promise<boolean>; failed: boolean };

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
        void this.enter(id, visit, pendingWrites());
        return () => {
            if (this.views.get(id) === visit) {
                this.views.delete(id);
                this.lock(id, false);
            }
        };
    }

    changed(change: KnowledgeChange): void {
        for (const [id, visit] of this.views) {
            const ids = visit.view.changed(change);
            for (const object of ids) visit.ids.add(object);
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
            if (next) void this.enter(id, next, pendingWrites());
        }
    }

    private leave(id: string): void {
        const visit = this.views.get(id);
        if (!visit?.view.pending?.()) return;
        const flush = async (): Promise<boolean> => {
            // This also orders buffered keys from a short visit A → B → C before C's read.
            if (visit.reading && !await visit.reading) return false;
            return await visit.view.flush?.() ?? true;
        };
        const done = flush().catch(problem => {
            this.error(problem);
            return false;
        });
        const departure: Departure = { id, done, failed: false };
        this.departures.add(departure);
        void done.then(ok => {
            if (ok) this.departures.delete(departure);
            else departure.failed = true;
        });
    }

    private enter(id: string, visit: Visit, writes?: Promise<unknown>[]): Promise<boolean> | undefined {
        const previous = visit.reading;
        if (previous && !writes) return previous;
        // The author must be able to correct an invalid value after a failed save.
        const prior = [...this.departures].filter(d => !(d.failed && d.id === id));
        if (previous && !writes?.length && !prior.length) return previous;
        if (!writes?.length && !prior.length && !visit.initial && !visit.ids.size && !visit.blocked) return;
        visit.blocked = true;
        this.lock(id, true);
        const read = async (): Promise<boolean> => {
            await Promise.all([previous, ...(writes ?? [])]);
            for (const departure of prior) {
                if (!await departure.done) {
                    const source = this.views.get(departure.id);
                    if (source?.view.flush && !await source.view.flush()) throw new LabloomError({ kind: "page-unsaved" });
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
                if (visit.reading === task) {
                    visit.reading = undefined;
                    visit.blocked = false;
                    this.lock(id, false);
                }
                // A write can be waiting for keystrokes buffered during this read.
                visit.view.ready?.();
            }
            return true;
        };
        // Install the promise before any read can synchronously publish another change.
        const task = Promise.resolve().then(read).catch(problem => {
            if (visit.reading === task && this.views.get(id) === visit) {
                visit.reading = undefined;
                this.failed?.(id);
                this.error(problem);
            }
            return false;
        });
        visit.reading = task;
        return task;
    }

    async settled(id: string): Promise<boolean> {
        const visit = this.views.get(id);
        return !visit || (await this.enter(id, visit) ?? true);
    }
}