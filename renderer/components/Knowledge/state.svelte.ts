import { PageWrites, fallbackFields, fields, reviewEdit, type Fields } from "./page-writes";
import { confirmationText } from "../../../shared/content/confirmation";
import { changedUses, references } from "../../../shared/content/blocks";
import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
import { type Backlink, type ChangePreview, type Changed, type CommitResult, type KnowledgeChange, type PageRecord } from "../../../shared/types/content";
import { type HistoryState } from "../../../shared/types/knowledge";
import { PendingInput } from "../Editor/pending-input";
import { readingTabs, visits } from "../Tab/activity.svelte";
import type { TabChange, TabView } from "../Tab/visits";
import { SessionViews, sessionKey } from "./session-views";
import { knowledgeState, message, perform } from "./feedback.svelte";
export { knowledgeState, message, perform } from "./feedback.svelte";
export const confirmation = $state<{ heading: string; text: string; names: string[]; resolve: ((value: boolean) => void) | null }>({ heading: "", text: "", names: [], resolve: null });
export function ask(heading: string, text: string, names: string[] = []): Promise<boolean> {
    if (confirmation.resolve) return Promise.resolve(false);
    return new Promise(resolve => Object.assign(confirmation, { heading, text, names, resolve }));
}
export function answer(value: boolean): void {
    const resolve = confirmation.resolve;
    confirmation.resolve = null;
    resolve?.(value);
}
export async function confirmed(commit: (token?: string) => Promise<CommitResult>): Promise<boolean> {
    let result = await commit();
    while (result.status === "confirmation") {
        const { preview } = result;
        if (!await ask(preview.deletedBlocks.length ? "删除块" : "确认本次更改", confirmationText(preview))) return false;
        result = await commit(preview.token);
    }
    return true;
}
export async function define(id: string, value: AttributeDefinition | null, tabId: string): Promise<boolean> {
    let impact = await window.api.knowledge.define(id, value, tabId);
    while (impact) {
        if (!await ask("修改共享属性", `以下页面的属性值会被清空、移除或调整。${impact.recycled?.length ? `同时有 ${impact.recycled.length} 个页面失去保留关系，将进入回收站。` : ""}`, [...impact.pages, ...(impact.recycled ?? [])].map(page => page.title))) return false;
        impact = await window.api.knowledge.define(id, value, tabId, impact.token);
    }
    return true;
}

export const copyData = <T>(value: T): T => JSON.parse(JSON.stringify(value));
class PageState {
    page = $state.raw<PageRecord | null>(null);
    loading = $state(true);
    saving = $state(false);
    dirty = $state(false);
    error = $state("");
    history = $state<HistoryState>({ canUndo: false, redo: [] });
    definitions = $state.raw<AttributeDefinition[]>([]);
    backlinks = $state.raw<Backlink[]>([]);
}
export type PageSession = {
    state: PageState; refresh(): Promise<void>; reread(ids: string[]): Promise<void>; objects(ids: string[]): Promise<void>;
    tabId: string; input: PendingInput; release(): void;
    flush(): Promise<boolean>; stage(edit: Fields): void;
    review(edit: Fields, rollback: () => void, accept: (saved: boolean) => void, finish: () => void): void;
    action(commit: (token?: string) => Promise<CommitResult>): Promise<void>;
    watchObject(id: string, read: () => Promise<void>, own?: boolean): () => void;
    ownChange(change: KnowledgeChange): void;
    undo(direction: "undo" | "redo", branch?: string): Promise<void>; composition(active: boolean): void;
    attr(id: string, value: AttributeValue): void; detach(id: string): void; listen(fn: Listener): () => void;
};
type Listener = (ids: string[], whole: boolean) => void;
// This registry is not rendered; each session carries its own reactive state.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const sessions = new Map<string, PageSession>();
// Page views share a tab visit and history, while retaining separate page buffers.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const sessionViews = new Map<string, { views: SessionViews; release: () => void }>();
function registerPageView(tabId: string, view: TabView): () => void {
    let group = sessionViews.get(tabId);
    if (!group) {
        const views = new SessionViews();
        const remove = views.add(view);
        group = { views, release: visits.register(tabId, views) };
        sessionViews.set(tabId, group);
        return () => {
            remove();
            if (!views.size) {
                group!.release();
                sessionViews.delete(tabId);
            }
        };
    }
    const remove = group.views.add(view);
    visits.refresh(tabId);
    return () => {
        remove();
        if (!group.views.size) {
            group.release();
            sessionViews.delete(tabId);
        }
    };
}
// Pending writes are awaited at navigation boundaries, never rendered.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const auxiliary = new Map<Promise<unknown>, string>();
export function trackWrite<T>(tabId: string, promise: Promise<T>): Promise<T> {
    auxiliary.set(promise, tabId);
    void promise.finally(() => auxiliary.delete(promise)).catch(() => { });
    return promise;
}
function otherWrites(tabId: string): Promise<unknown>[] {
    return [...auxiliary].filter(([, owner]) => owner === tabId).map(([write]) => write);
}
export function registerList(tabId: string, intersection: TabView["intersection"], read: TabView["read"]): () => void {
    return visits.register(tabId, { intersection, read, ownChanges: true,
        pending: () => otherWrites(tabId).length ? "unknown" : undefined,
        flush: async () => {
            await Promise.all(otherWrites(tabId));
            return true;
        } });
}

function makeSession(tabId: string, pageId: string): PageSession {
    const state = new PageState(), api = window.api.knowledge, input = new PendingInput();
    // Unacknowledged container edits may change a sync border in another page.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const pendingUses = new Set<string>();
    let broadChange = false;
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
            knowledgeState.error = message(error);
        });
        return () => {
            group.delete(read);
            if (!group.size) observers.delete(id);
        };
    }
    function ownChange(change: KnowledgeChange): void {
        void history().catch(error => {
            knowledgeState.error = message(error);
        });
        for (const id of [...(change.summaryPages ?? change.pages), ...change.blocks]) {
            for (const [read, own] of observers.get(id) ?? []) if (own || change.highlightPages?.includes(id)) void perform(read);
        }
        if (change.backlinks?.includes(pageId)) void perform(async () => {
            state.backlinks = await api.backlinks(pageId);
        });
    }
    // Only uncommitted newly allocated IDs can disappear entirely within a debounce interval.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const newBlocks = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined, composing = false;
    let reviewing: Promise<void> | undefined, load = 0;
    const prompt = (p: ChangePreview): Promise<boolean> => ask("确认本次更改", confirmationText(p));
    const history = async (): Promise<void> => {
        state.history = await api.history(tabId);
    };
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
    const writes = new PageWrites(tabId, pageId, async input => {
        let result = await api.commitEdit(input);
        while (result.status === "confirmation") {
            // Retention can change between preview and commit. Restore only the disputed fields.
            const causes = new Set(result.preview.causes);
            const disputed = input.blocks.filter(b => causes.has(b.id));
            const ids = [pageId, ...disputed.map(b => b.id)];
            const stored = await api.readObjects(pageId, ids);
            const { safe, restore, proposed } = fallbackFields(input, causes, stored, key => writes.current(key));
            apply(fields(restore));
            notify(ids);
            if (!await prompt(result.preview)) {
                writes.retain(fields(safe));
                return;
            }
            result = await api.commitEdit(input, result.preview.token);
            if (result.status === "saved") {
                for (const key of proposed.keys()) if (!writes.current(key)) proposed.delete(key);
                apply(fields(proposed));
                notify(ids);
            }
        }
        input.blocks.forEach(block => newBlocks.delete(block.id));
        updateCounts(result.changed.blocks, result.sharedUses ?? {});
        await history().catch(e => {
            knowledgeState.error = message(e);
        });
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
            if (block.id === page.titleBlockId) publish = true;
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
        let structural = false;
        function trackChildren(before: string[], after: string[]): void {
            if (!changedChildren(before, after)) return;
            structural = true;
            for (const [id, delta] of changedUses(before, after)) {
                pendingUses.add(id);
                const removed = page!.blocks[id];
                if (delta < 0 && removed && (removed.children.length || references(removed).length)) broadChange = true;
            }
        }
        if (edit.pageChildren) trackChildren(page.children, edit.pageChildren);
        for (const block of edit.blocks) trackChildren(page.blocks[block.id]?.children ?? [], block.children);
        const attributes = [...Object.keys(edit.attributes ?? {}), ...edit.detach ?? []];
        // A change to the last reference can recycle pages outside the current document.
        const linksChanged = edit.blocks.some(block => {
            const before = page.blocks[block.id] ? references(page.blocks[block.id]) : [], after = references(block);
            return before.length !== after.length || before.some((target, index) => target.kind !== after[index].kind || target.id !== after[index].id);
        });
        broadChange ||= linksChanged || edit.attributes?.independent === false || attributes.some(id =>
            state.definitions.some(def => def.id === id && (def.type === "page-link" || def.type === "page-links")));
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
            state.error = "保存失败，可重试。" + message(error);
            return false;
        }
        finally {
            state.saving = false;
            state.dirty = writes.unsaved || !!reviewing;
            if (!state.dirty) {
                broadChange = false;
                pendingUses.clear();
            }
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
    async function refresh(): Promise<void> {
        const request = ++load;
        if (!await flush()) return;
        state.loading = true;
        try {
            const [page, undo] = await Promise.all([api.get(pageId).then(record => {
                performance.clearMarks("labloom:page-read");
                performance.mark("labloom:page-read", { detail: pageId });
                return record;
            }), api.history(tabId)]);
            if (request !== load) return;
            newBlocks.clear();
            state.page = page;
            state.history = undo;
            state.error = "";
            notify([], true);
        }
        catch (e) {
            state.error = message(e);
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
        let needed = [...new Set(ids)], structural = false;
        while (needed.length) {
            const data = await api.readObjects(pageId, needed);
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
            needed = [...new Set(children.filter(id => !seen.has(id) && !page.blocks[id]))];
        }
        if (structural) pruneDetached();
    }
    async function reread(ids: string[]): Promise<void> {
        if (!state.page || !ids.length || !await flush()) return;
        await objects(ids, true);
        state.page = { ...state.page };
        notify(ids);
        await history();
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
                await reviewEdit(input, value => api.previewEdit(value), prompt, async (value, token) => {
                    const result = await api.commitEdit(value, token);
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
                        void history().catch(e => {
                            knowledgeState.error = message(e);
                        });
                    }
                });
            }
            catch (e) {
                state.error = "保存失败，可重试。" + message(e);
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
    async function action(commit: (token?: string) => Promise<CommitResult>): Promise<void> {
        if (!await flush()) return;
        let changed: Changed | undefined;
        if (await confirmed(async token => {
            const result = await commit(token);
            if (result.status === "saved") changed = result.changed;
            return result;
        }) && changed) {
            const ids = [...changed.pages, ...changed.blocks];
            // An undo belongs to the tab, and may target its now-closed annotation.
            for (const value of sessions.values()) if (value.tabId === tabId) {
                const page = value.state.page;
                if (page) await value.reread(ids.filter(id => id === page.id || Object.hasOwn(page.blocks, id)));
            }
            if (!readingTabs.has(tabId) && !state.page?.attributes.deleted) input.replay();
        }
    }
    const trackedAction = (commit: (token?: string) => Promise<CommitResult>): Promise<void> => trackWrite(tabId, action(commit));
    const undo = (direction: "undo" | "redo", branch?: string): Promise<void> => trackedAction(token => api.undo(tabId, direction, branch, token));
    let definitionsDirty = false;
    const intersection = (change: TabChange): string[] => [
        ...change.pages.filter(id => id === pageId),
        ...(change.summaryPages ?? change.pages).filter(id => observers.has(id)),
        ...change.blocks.filter(id => !state.page || readingObjects || Object.hasOwn(state.page.blocks, id) || observers.has(id)),
        ...(change.definition ? [change.definition] : []),
        ...(change.backlinks?.includes(pageId) ? [pageId] : []),
        ...change.pages.filter(id => state.backlinks.some(link => link.sourceId === id))
    ];
    const release = registerPageView(tabId, {
        intersection: change => {
            definitionsDirty ||= !!change.definition;
            return intersection(change);
        },
        pending: () => {
            if (composing || reviewing || broadChange || input.waiting || otherWrites(tabId).length) return "unknown";
            if (writes.unsaved) {
                const blocks = [...writes.changedBlocks(), ...pendingUses], page = state.page;
                // A shared ancestor can expose a changed paragraph in a different kind of page.
                const otherOwners = blocks.length && (Object.keys(page?.sharedUses ?? {}).length || [...pendingUses].some(id => !newBlocks.has(id)));
                return { pages: [pageId], blocks, kinds: page && !otherOwners ? { [pageId]: page.kind } : undefined };
            }
            return undefined;
        },
        flush: async () => {
            await Promise.all(otherWrites(tabId));
            if (await flush()) return true;
            knowledgeState.error = state.error || "页面输入尚未保存，请结束输入法组字后重试。";
            return false;
        },
        read: async (ids, initial) => {
            readingObjects = true;
            try {
                if (initial) await refresh();
                else if (state.page) {
                    if (!await flush()) throw new Error(state.error || "页面输入尚未保存。");
                    await reread(ids.filter(id => id === pageId || Object.hasOwn(state.page!.blocks, id)));
                }
                if (state.error) throw new Error(state.error);
                if (initial || definitionsDirty) {
                    definitionsDirty = false;
                    try {
                        state.definitions = await api.definitions();
                    }
                    catch (error) {
                        definitionsDirty = true;
                        throw error;
                    }
                }
                if (initial || ids.includes(pageId) || ids.some(id => state.backlinks.some(link => link.sourceId === id)))
                    state.backlinks = await api.backlinks(pageId);
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
        tabId, input, release, state, refresh, reread, objects, flush, stage, review, action: trackedAction, undo, composition, watchObject, ownChange,
        attr: (id: string, value: AttributeValue) => stage({ blocks: [], attributes: { [id]: copyData(value) } }),
        detach: (id: string) => stage({ blocks: [], detach: [id] }),
        listen(fn: Listener) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}
export function session(tabId: string, pageId: string): PageSession {
    const key = sessionKey(tabId, pageId);
    let value = sessions.get(key);
    if (!value) {
        value = makeSession(tabId, pageId);
        sessions.set(key, value);
    }
    return value;
}
export function receiveChange(change: KnowledgeChange): void {
    visits.changed(change);
    for (const value of sessions.values()) if (value.tabId === change.sourceTab) value.ownChange(change);
    knowledgeState.change = { ...change, seq: knowledgeState.change.seq + 1 };
}
export async function saveAll(): Promise<boolean> {
    window.dispatchEvent(new Event("workspace-flush"));
    try {
        const prior = [...auxiliary.keys()];
        const pages = [...sessions.values()].map(async value => {
            if (readingTabs.has(value.tabId) && !await visits.settled(value.tabId)) throw new Error(knowledgeState.error || "读取页面失败。");
            if (value.input.waiting) throw new Error("仍有等待同步的输入。请先回到原标签页；页面已回收时请先恢复。");
            if (!await value.flush()) throw new Error(value.state.error || "请先结束输入法组字，页面输入尚未保存。");
        });
        await Promise.all([...prior, ...pages]);
    }
    catch (error) {
        knowledgeState.error = message(error);
        return false;
    }
    return true;
}
export function writeFromTab<T>(id: string, action: () => Promise<T>): Promise<T | undefined> {
    // Take the barriers before registering this operation. A quick departure must see the
    // entire operation, but the operation must never wait for itself.
    const before = Promise.all([visits.settled(id), saveAll()]);
    return trackWrite(id, before.then(([ready, saved]) => ready && saved ? action() : undefined));
}
export async function closeSession(tabId: string): Promise<boolean> {
    window.dispatchEvent(new Event("workspace-flush"));
    const values = [...sessions.values()].filter(value => value.tabId === tabId);
    if (!await visits.settled(tabId) || values.some(value => value.input.waiting)) {
        knowledgeState.error = "此页面未保存，已保留标签页。请处理页面上显示的错误。";
        return false;
    }
    for (const value of values) if (!await value.flush()) {
        knowledgeState.error = "此页面未保存，已保留标签页。请处理页面上显示的错误。";
        return false;
    }
    await Promise.all(otherWrites(tabId));
    await window.api.knowledge.closeTab(tabId);
    for (const [key, value] of sessions) if (value.tabId === tabId) {
        value.release();
        sessions.delete(key);
    }
    return true;
}