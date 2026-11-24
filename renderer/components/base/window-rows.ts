import { SvelteMap } from "svelte/reactivity";

export class WindowRows<T extends { id: string }> {
    readonly rows = new SvelteMap<string, T>();
    private current = new Set<string>();
    private pending = new Set<string>();
    private revision = 0;

    constructor(private readonly read: (ids: string[]) => Promise<T[]>, private readonly onerror: (error: unknown) => void) {}

    start(items: T[], clear = false): void {
        this.revision++;
        this.current = new Set();
        this.pending = new Set();
        if (clear) this.rows.clear();
        this.update(items);
    }

    update(items: T[]): void {
        for (const item of items) {
            this.current.add(item.id);
            const old = this.rows.get(item.id);
            if (!old || Object.keys(item).some(key => item[key as keyof T] !== old[key as keyof T])) this.rows.set(item.id, item);
        }
    }

    async request(ids: string[]): Promise<void> {
        const version = this.revision, pending = this.pending;
        const missing = ids.filter(id => !this.current.has(id) && !pending.has(id));
        if (!missing.length) return;
        missing.forEach(id => pending.add(id));
        try {
            const items = await this.read(missing);
            if (version !== this.revision) return;
            for (const id of missing) this.current.add(id);
            this.update(items);
        }
        catch (error) {
            if (version === this.revision) this.onerror(error);
        }
        finally {
            missing.forEach(id => pending.delete(id));
        }
    }
}