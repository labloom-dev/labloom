import { type AttributeValue } from "../../../shared/types/attributes";
import { type ContentBlock, type PageObjects, type EditCommit, type ChangePreview, type CommitResult } from "../../../shared/types/content";

export type Fields = Pick<EditCommit, "blocks" | "pageChildren" | "attributes" | "detach">;
export type Entry = { kind: "block"; value: ContentBlock } | { kind: "children"; value: string[] } | { kind: "attr"; id: string; value?: AttributeValue };
export function entries(edit: Fields): [string, Entry][] {
    const result: [string, Entry][] = edit.blocks.map(b => ["b:" + b.id, { kind: "block", value: b }]);
    if (edit.pageChildren) result.push(["children", { kind: "children", value: edit.pageChildren }]);
    for (const [id, value] of Object.entries(edit.attributes ?? {})) result.push(["a:" + id, { kind: "attr", id, value }]);
    for (const id of edit.detach ?? []) result.push(["a:" + id, { kind: "attr", id }]);
    return result;
}
export function fields(rows: Map<string, Entry>): Fields {
    const edit: Fields = { blocks: [] };
    for (const row of rows.values()) {
        if (row.kind === "block") edit.blocks.push(row.value);
        else if (row.kind === "children") edit.pageChildren = row.value;
        else if (row.value === undefined) (edit.detach ??= []).push(row.id);
        else (edit.attributes ??= {})[row.id] = row.value;
    }
    return edit;
}
export class PageWrites {
    private readonly dirty = new Map<string, Entry>();
    private retry?: { input: EditCommit; rows: Map<string, Entry> };
    private pending?: Promise<void>;
    private batch = 0;
    constructor(readonly tabId: string, readonly pageId: string, readonly send: (input: EditCommit) => Promise<void>) { }
    get unsaved(): boolean {
        return !!this.dirty.size || !!this.retry;
    }
    changedBlocks(): string[] {
        return [...this.dirty.values()].flatMap(row => row.kind === "block" ? [row.value.id] : []);
    }
    input(edit: Fields): EditCommit {
        return { tabId: this.tabId, pageId: this.pageId, batch: ++this.batch, ...edit };
    }
    stage(edit: Fields): void {
        for (const [key, item] of entries(edit)) this.dirty.set(key, item);
    }
    current(key: string): boolean {
        return this.retry?.rows.get(key) === this.dirty.get(key);
    }
    retain(edit: Fields): void {
        for (const [key, row] of entries(edit)) if (this.current(key)) this.dirty.set(key, row);
    }
    dropNew(id: string): void {
        this.dirty.delete("b:" + id);
    }
    async flush(all = true, allowed: () => boolean = () => true): Promise<void> {
        if (this.pending) {
            await this.pending;
            if (all && this.unsaved && allowed()) await this.flush(all, allowed);
            return;
        }
        const drain = async (): Promise<void> => {
            while (this.unsaved && allowed()) {
                const rows = this.retry?.rows ?? new Map(this.dirty);
                const input = this.retry?.input ?? this.input(fields(rows));
                this.retry = { input, rows };
                await this.send(input);
                this.retry = undefined;
                for (const [key, item] of rows) if (this.dirty.get(key) === item) this.dirty.delete(key);
                if (!all) break;
            }
        };
        this.pending = drain();
        try {
            await this.pending;
        }
        finally {
            this.pending = undefined;
        }
    }
}
// Reinsert only removed occurrences. Independent additions and moves in the same batch survive cancellation.
export function restoreOccurrences(before: string[], after: string[], causes: Set<string>): string[] {
    const next = [...after], remaining = new Map<string, number>();
    for (const id of after) remaining.set(id, (remaining.get(id) ?? 0) + 1);
    let anchor = next.length;
    for (let i = before.length - 1; i >= 0; i--) {
        const id = before[i], n = remaining.get(id) ?? 0;
        if (n) {
            remaining.set(id, n - 1);
            const found = next.lastIndexOf(id, anchor - 1);
            if (found >= 0) anchor = found;
        }
        else if (causes.has(id)) next.splice(anchor, 0, id);
    }
    return next;
}
export function fallbackFields(input: EditCommit, causes: Set<string>, stored: PageObjects, current: (key: string) => boolean): Record<"safe" | "restore" | "proposed", Map<string, Entry>> {
    const safe = new Map(entries(input)), restore = new Map<string, Entry>(), proposed = new Map<string, Entry>();
    for (const [key, row] of entries(input)) {
        let previous: Entry | undefined;
        if (row.kind === "attr" && causes.has("attribute:" + row.id)) previous = { kind: "attr", id: row.id, value: stored.page!.attributes[row.id] };
        if (row.kind === "block" && causes.has(row.value.id)) {
            const value = stored.blocks.find(b => b.id === row.value.id);
            if (value) previous = { kind: "block", value };
        }
        if (row.kind === "children") {
            const value = restoreOccurrences(stored.page!.children, row.value, causes);
            if (value.length !== row.value.length) previous = { kind: "children", value };
        }
        if (!previous) continue;
        safe.delete(key);
        if (previous.kind === "children" && JSON.stringify(previous.value) !== JSON.stringify(stored.page!.children)) safe.set(key, previous);
        if (current(key)) {
            restore.set(key, previous);
            proposed.set(key, row);
        }
    }
    return { safe, restore, proposed };
}
// The proposed deletion stays out of the autosave queue until its preview is resolved.
export async function reviewEdit(input: EditCommit, preview: (input: EditCommit) => Promise<ChangePreview | null>,
    ask: (preview: ChangePreview) => Promise<boolean>, commit: (input: EditCommit, token: string) => Promise<CommitResult>,
    rollback: () => void, accept: (saved: boolean) => void): Promise<void> {
    let impact = await preview(input);
    if (!impact) {
        accept(false);
        return;
    }
    rollback();
    while (await ask(impact)) {
        const result = await commit(input, impact.token);
        if (result.status === "saved") {
            accept(true);
            return;
        }
        impact = result.preview;
    }
}