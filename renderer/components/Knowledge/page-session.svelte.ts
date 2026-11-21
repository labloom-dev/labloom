import { watchHistory } from "./history";
import { type HistorySource } from "../../../shared/history/ipc";
import { PageWrites, fallbackFields, fields, reviewEdit, type Fields } from "./page-writes";
import { confirmationText } from "../../../shared/content/confirmation";
import { publishTitle } from "../Tab/page-titles";
import { blockText } from "../../../shared/content/blocks";
import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
import { type Backlink, type ChangePreview, type Changed, type CommitResult, type KnowledgeChange, type PageRecord } from "../../../shared/types/content";
import { type HistoryState } from "../../../shared/types/knowledge";
import { PendingInput } from "../Editor/pending-input";
import { readingTabs, visits } from "../Tab/activity.svelte";
import { registerPageView } from "./page-visits";
import { WriteReceipts } from "./write-tracker";
import { ask, confirmed } from "./confirmation.svelte";
import { copyData } from "../copy-data";
import { knowledgeState, perform } from "./feedback.svelte";
import { t, failure, type ErrorValue } from "../../i18n.svelte";
import { LabloomError } from "../../../shared/failure";

class PageState {
    page = $state.raw<PageRecord | null>(null);
    loading = $state(true);
    saving = $state(false);
    dirty = $state(false);
    error = $state<ErrorValue>("");
    history = $state<HistoryState>({ canUndo: false, canRedo: false });
    definitions = $state.raw<AttributeDefinition[]>([]);
    backlinks = $state.raw<Backlink[]>([]);
}
export type PageSession = {
    state: PageState; refresh(): Promise<void>; reread(ids: string[]): Promise<void>; objects(ids: string[]): Promise<void>;
    tabId: string; source: HistorySource; input: PendingInput; release(): void;
    flush(): Promise<boolean>; checkpoint(): void; stage(edit: Fields): void;
    review(edit: Fields, rollback: () => void, accept: (saved: boolean) => void, finish: () => void): void;
    action(commit: SessionCommit): Promise<void>;
    watchObject(id: string, read: () => Promise<void>, own?: boolean): () => void;
    undo(direction: "undo" | "redo"): Promise<void>; composition(active: boolean): void;
    attr(id: string, value: AttributeValue): void; detach(id: string): void; listen(fn: Listener): () => void;
};
type Listener = (ids: string[], whole: boolean) => void;
type SessionCommit = (confirmation: string | undefined, writeId: string) => Promise<CommitResult>;
export function makeSession(tabId: string, pageId: string, source: HistorySource,
    write: (action: () => Promise<void>) => Promise<void>, unregister: () => void): PageSession {
    const receipts = new WriteReceipts();
    const state = new PageState(), api = window.api, input = new PendingInput();
    const stopHistory = watchHistory(source, value => {
        state.history = value;
    });
    let readingObjects = false;
    // Cache membership follows containment, including every occurrence of a synchronous block.
    function pruneDetached(): void {
        const page = state.page;
        if (!page) return;
        // Traversal is local to this call and never observed by the UI.
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const visible = new Set<string>(), stack = [page.titleBlockId, ...page.children];
        while (stack.length) {
            const id = stack.pop()!;
            if (visible.has(id)) continue;
            visible.add(id);
            stack.push(...(page.blocks[id]?.children ?? []));
        }
        for (const id of Object.keys(page.blocks)) if (!visible.has(id)) {
            if (newBlocks.delete(id)) writes.dropNew(id);
            delete page.blocks[id];
        }
    }
    // Subscription bookkeeping is independent of Svelte rendering.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const listeners = new Set<Listener>();
    // Mounted reference cards and PDF resources have their own object dependencies.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const observers = new Map<string, Map<() => Promise<void>, boolean>>();
    function watchObject(id: string, read: () => Promise<void>, own = false): () => void {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const group = observers.get(id) ?? new Map();
        group.set(read, own);
        observers.set(id, group);
        void visits.settled(tabId).then(ok => {
            if (ok && group.has(read)) return read();
            return undefined;
        }).catch(error => {
            knowledgeState.error = failure(error);
        });
        return () => {
            group.delete(read);
            if (!group.size) observers.delete(id);
        };
    }
    function ownChange(change: KnowledgeChange): void {
        for (const id of [...(change.summaryPages ?? change.pages), ...change.blocks]) {
            for (const [read, own] of observers.get(id) ?? []) if (own || change.highlightPages?.includes(id)) void perform(read);
        }
        if (change.backlinks?.includes(pageId)) void perform(async () => {
            state.backlinks = await api.pages.backlinks(pageId);
        });
    }
    // Only uncommitted newly allocated IDs can disappear entirely within a debounce interval.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const newBlocks = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined, composing = false;
    let reviewing: Promise<void> | undefined, load = 0;
    const prompt = (p: ChangePreview): Promise<boolean> => ask(() => t("dialog.change"), () => confirmationText(p, t));
    function updateCounts(ids: string[], uses: Record<string, number>): void {
        if (!ids.length || !state.page) return;
        const counts = state.page.sharedUses ??= {};
        let changed = false;
        for (const id of ids) {
            if (counts[id] === uses[id]) continue;
            changed = true;
            if (uses[id]) counts[id] = uses[id];
            else delete counts[id];
        }
        if (changed) for (const listener of listeners) listener([], false);
    }
    const writes = new PageWrites(pageId, async input => {
        let result = await receipts.submit(id => api.pages.commitEdit(input, source, undefined, id));
        while (result.status === "confirmation") {
            // Retention can change between preview and commit. Restore only the disputed fields.
            // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Temporary lookup for this request.
            const causes = new Set(result.preview.causes);
            const disputed = input.blocks.filter(b => causes.has(b.id));
            const ids = [pageId, ...disputed.map(b => b.id)];
            const stored = await api.pages.readObjects(pageId, ids);
            const { safe, restore, proposed } = fallbackFields(input, causes, stored, key => writes.current(key));
            apply(fields(restore));
            notify(ids);
            if (!await prompt(result.preview)) {
                writes.retain(fields(safe));
                return;
            }
            const token = result.preview.token;
            result = await receipts.submit(id => api.pages.commitEdit(input, source, token, id));
            if (result.status === "saved") {
                for (const key of proposed.keys()) if (!writes.current(key)) proposed.delete(key);
                apply(fields(proposed));
                notify(ids);
            }
        }
        input.blocks.forEach(block => newBlocks.delete(block.id));
        updateCounts(result.changed.blocks, result.sharedUses ?? {});
    });
    function notify(ids: string[], whole = false): void {
        for (const listener of listeners) listener(ids, whole);
    }
    function apply(edit: Fields): void {
        const page = state.page;
        if (!page) return;
        let publish = !!edit.attributes || !!edit.detach || !!edit.pageChildren;
        for (const block of edit.blocks) {
            page.blocks[block.id] = block;
            if (block.id === page.titleBlockId) {
                publish = true;
                publishTitle(pageId, blockText(block));
            }
        }
        if (edit.pageChildren) page.children = edit.pageChildren;
        if (edit.attributes || edit.detach) {
            page.attributes = { ...page.attributes, ...edit.attributes };
            for (const id of edit.detach ?? []) delete page.attributes[id];
        }
        if (publish) state.page = { ...page };
    }
    function schedule(): void {
        clearTimeout(timer);
        state.dirty = writes.unsaved || !!reviewing;
        if (state.dirty && !composing && !reviewing) timer = setTimeout(() => void drain(false), 600);
    }
    function changedChildren(before: string[], after: string[]): boolean {
        return before.length !== after.length || after.some((id, index) => id !== before[index]);
    }
    function stage(edit: Fields): void {
        const page = state.page;
        if (!page) return;
        for (const block of edit.blocks) if (!page.blocks[block.id]) newBlocks.add(block.id);
        const structural = (edit.pageChildren && changedChildren(page.children, edit.pageChildren))
            || edit.blocks.some(block => changedChildren(page.blocks[block.id]?.children ?? [], block.children));
        apply(edit);
        writes.stage(edit);
        if (structural) pruneDetached();
        schedule();
    }
    async function drain(all = true): Promise<boolean> {
        clearTimeout(timer);
        if (composing) return false;
        if (!writes.unsaved) return true;
        state.saving = true;
        try {
            await writes.flush(all, () => !composing);
            state.error = "";
            return !all || !writes.unsaved;
        }
        catch (error) {
            state.error = failure(error);
            return false;
        }
        finally {
            state.saving = false;
            state.dirty = writes.unsaved || !!reviewing;
        }
    }
    async function flush(): Promise<boolean> {
        // Windows finalizes IME text after blur, before the next macrotask.
        if (composing) await new Promise<void>(resolve => setTimeout(resolve, 32));
        if (reviewing) await reviewing;
        return drain();
    }
    function composition(active: boolean): void {
        composing = active;
        if (active) clearTimeout(timer); else schedule();
    }
    async function readPage(): Promise<PageRecord> {
        const page = await api.pages.get(pageId);
        performance.clearMarks("labloom:page-read");
        performance.mark("labloom:page-read", { detail: pageId });
        return page;
    }
    async function refresh(initial = false): Promise<void> {
        const request = ++load;
        if (!await flush()) return;
        state.loading = true;
        try {
            // Publish the initial document with its metadata so Chromium lays it out once.
            const [page, definitions, backlinks] = await Promise.all([readPage(),
                initial ? api.attributes.definitions() : undefined,
                initial ? api.pages.backlinks(pageId) : undefined]);
            if (request !== load) return;
            if (definitions) state.definitions = definitions;
            if (backlinks) state.backlinks = backlinks;
            newBlocks.clear();
            state.page = page;
            state.error = "";
            notify([], true);
        }
        catch (e) {
            if (request === load) state.error = failure(e);
        }
        finally {
            if (request === load) state.loading = false;
        }
    }
    async function objects(ids: string[], prune = false): Promise<void> {
        const page = state.page;
        if (!page) return;
        // Visited objects for this read request only.
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const seen = new Set<string>();
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Temporary lookup for this request.
        let needed = [...new Set(ids)], structural = false;
        while (needed.length) {
            const data = await api.pages.readObjects(pageId, needed);
            needed.forEach(id => seen.add(id));
            page.sharedUses ??= {};
            for (const id of needed) {
                if (data.uses[id]) page.sharedUses[id] = data.uses[id];
                else delete page.sharedUses[id];
            }
            if (data.page) {
                structural ||= prune && changedChildren(page.children, data.page.children);
                page.attributes = data.page.attributes;
                page.children = data.page.children;
            }
            const children = [...(data.page?.children ?? [])];
            for (const b of data.blocks) {
                structural ||= prune && changedChildren(page.blocks[b.id]?.children ?? [], b.children);
                page.blocks[b.id] = b;
                children.push(...b.children);
            }
            // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Temporary lookup for this request.
            needed = [...new Set(children.filter(id => !seen.has(id) && !page.blocks[id]))];
        }
        if (structural) pruneDetached();
    }
    async function reread(ids: string[]): Promise<void> {
        if (!state.page || !ids.length || !await flush()) return;
        await objects(ids, true);
        state.page = { ...state.page };
        notify(ids);
    }
    function review(edit: Fields, rollback: () => void, accept: (saved: boolean) => void, finish: () => void): void {
        clearTimeout(timer);
        const task = async (): Promise<void> => {
            if (!await drain()) {
                rollback();
                return;
            }
            const input = writes.input(edit);
            try {
                let savedResult: Extract<CommitResult, { status: "saved" }> | undefined;
                await reviewEdit(input, value => api.pages.previewEdit(value), prompt, async (value, token) => {
                    const result = await receipts.submit(id => api.pages.commitEdit(value, source, token, id));
                    if (result.status === "saved") savedResult = result;
                    return result;
                }, rollback, saved => {
                    if (saved) {
                        apply(edit);
                        pruneDetached();
                    }
                    accept(saved);
                    if (savedResult) {
                        updateCounts(savedResult.changed.blocks, savedResult.sharedUses ?? {});
                    }
                });
            }
            catch (e) {
                state.error = failure(e);
                accept(false);
            }
        };
        reviewing = task().finally(() => {
            reviewing = undefined;
            finish();
            schedule();
        });
        state.dirty = true;
    }
    async function applyAction(commit: SessionCommit): Promise<void> {
        let changed: Changed | undefined;
        await confirmed(async token => {
            const result = await receipts.submit(id => commit(token, id));
            if (result.status === "saved") changed = result.changed;
            return result;
        });
        if (!changed || !state.page) return;
        const page = state.page;
        await reread([...changed.pages, ...changed.blocks].filter(id => id === pageId || Object.hasOwn(page.blocks, id)));
        if (!readingTabs.has(tabId) && !state.page?.attributes.deleted) input.replay();
    }
    function undo(direction: "undo" | "redo"): Promise<void> {
        if (readingTabs.has(tabId)) return Promise.resolve();
        return perform(() => write(async () => {
            const history = await api.history.state(source);
            if (direction === "undo" ? history.canUndo : history.canRedo) {
                await applyAction((token, id) => api.history.apply(source, direction, token, id));
            }
        }));
    }
    let definitionsDirty = false;
    const intersection = (change: KnowledgeChange): string[] => [
        ...change.pages.filter(id => id === pageId),
        ...(change.summaryPages ?? change.pages).filter(id => observers.has(id)),
        ...change.blocks.filter(id => !state.page || readingObjects || Object.hasOwn(state.page.blocks, id) || observers.has(id)),
        ...(change.definition ? [change.definition] : []),
        ...(change.backlinks?.includes(pageId) ? [pageId] : []),
        ...change.pages.filter(id => state.backlinks.some(link => link.sourceId === id))
    ];
    const release = registerPageView(tabId, {
        changed: change => {
            if (receipts.take(change.writeId)) {
                ownChange(change);
                return [];
            }
            definitionsDirty ||= !!change.definition;
            return intersection(change);
        },
        pending: () => composing || !!reviewing || input.waiting || writes.unsaved,
        flush: async () => {
            if (await flush()) return true;
            knowledgeState.error = state.error || { kind: "page-composing" };
            return false;
        },
        read: async (ids, initial) => {
            readingObjects = true;
            try {
                if (initial) {
                    definitionsDirty = false;
                    await refresh(true);
                }
                else if (state.page) {
                    if (!await flush()) throw new LabloomError({ kind: "page-unsaved" });
                    await reread(ids.filter(id => id === pageId || Object.hasOwn(state.page!.blocks, id)));
                }
                if (state.error && state.error.kind === "page-unavailable" && !state.page) return;
                if (state.error) throw new LabloomError({ kind: "page-unsaved" });
                if (definitionsDirty) {
                    definitionsDirty = false;
                    try {
                        state.definitions = await api.attributes.definitions();
                    }
                    catch (error) {
                        definitionsDirty = true;
                        throw error;
                    }
                }
                if (!initial && (ids.includes(pageId) || ids.some(id => state.backlinks.some(link => link.sourceId === id))))
                    state.backlinks = await api.pages.backlinks(pageId);
                for (const id of ids) if (observers.has(id)) await Promise.all([...observers.get(id)!.keys()].map(read => read()));
            }
            finally {
                readingObjects = false;
            }
        },
        ready: () => {
            if (!state.page?.attributes.deleted) input.replay();
        }
    });
    return {
        tabId, source, input, release() {
            clearTimeout(timer); stopHistory(); release(); unregister();
        }, state, refresh, reread, objects, flush, checkpoint: () => writes.checkpoint(), stage, review, undo, composition, watchObject,
        action: commit => write(() => applyAction(commit)),
        attr: (id: string, value: AttributeValue) => stage({ blocks: [], attributes: { [id]: copyData(value) } }),
        detach: (id: string) => stage({ blocks: [], detach: [id] }),
        listen(fn: Listener) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}