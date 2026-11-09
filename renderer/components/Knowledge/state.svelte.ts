import { PageWrites, fallbackFields, fields, reviewEdit, type Fields } from "./page-writes";
import { confirmationText } from "../../../shared/content/confirmation";
import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
import { type ChangePreview, type Changed, type CommitResult, type KnowledgeChange, type PageRecord } from "../../../shared/types/content";
import { type HistoryState } from "../../../shared/types/knowledge";

export const knowledgeState = $state<{ change: KnowledgeChange & { seq: number }; error: string; busy: boolean }>({
    change: { sourceTab: "", pages: [], blocks: [], seq: 0 }, error: "", busy: false
});
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
export const message = (error: unknown): string => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(error);
export async function perform(action: () => Promise<void>): Promise<void> {
    try {
        knowledgeState.error = "";
        await action();
    }
    catch (error) {
        knowledgeState.error = message(error);
    }
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
export async function define(id: string, value: AttributeDefinition | null): Promise<boolean> {
    let impact = await window.api.knowledge.define(id, value);
    while (impact) {
        if (!await ask("修改共享属性", `以下页面的属性值会被清空、移除或调整。${impact.recycled?.length ? `同时有 ${impact.recycled.length} 个页面失去保留关系，将进入回收站。` : ""}`, [...impact.pages, ...(impact.recycled ?? [])].map(page => page.title))) return false;
        impact = await window.api.knowledge.define(id, value, impact.token);
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
}
export type PageSession = {
    state: PageState; refresh(): Promise<void>; reread(ids: string[]): Promise<void>; objects(ids: string[]): Promise<void>;
    flush(): Promise<boolean>; save(): Promise<boolean>; stage(edit: Fields): void;
    review(edit: Fields, rollback: () => void, accept: (saved: boolean) => void, finish: () => void): void;
    action(commit: (token?: string) => Promise<CommitResult>): Promise<void>; discard(): Promise<void>;
    undo(direction: "undo" | "redo", branch?: string): Promise<void>; composition(active: boolean): void;
    attr(id: string, value: AttributeValue): void; detach(id: string): void; listen(fn: Listener): () => void;
};
type Listener = (ids: string[], whole: boolean) => void;
// This registry is not rendered; each session carries its own reactive state.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const sessions = new Map<string, PageSession>();
// Pending writes are awaited at navigation boundaries, never rendered.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const auxiliary = new Set<Promise<unknown>>();
export function trackWrite(promise: Promise<unknown>): void {
    auxiliary.add(promise);
    void promise.finally(() => auxiliary.delete(promise)).catch(() => { });
}

function makeSession(tabId: string, pageId: string): PageSession {
    const state = new PageState(), api = window.api.knowledge;
    // Subscription bookkeeping is independent of Svelte rendering.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const listeners = new Set<Listener>();
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
    function stage(edit: Fields): void {
        const page = state.page;
        if (!page) return;
        for (const block of edit.blocks) if (!page.blocks[block.id]) newBlocks.add(block.id);
        const structural = edit.pageChildren !== undefined || edit.blocks.some(b => b.children.length !== (page.blocks[b.id]?.children.length ?? 0)
            || b.children.some((id, i) => id !== page.blocks[b.id]?.children[i]));
        apply(edit);
        writes.stage(edit);
        if (structural && newBlocks.size) {
            // Reachability is temporary batch bookkeeping.
            // eslint-disable-next-line svelte/prefer-svelte-reactivity
            const reachable = new Set<string>(), stack = [...page.children];
            while (stack.length) {
                const id = stack.pop()!;
                if (reachable.has(id)) continue;
                reachable.add(id);
                stack.push(...(page.blocks[id]?.children ?? []));
            }
            for (const id of newBlocks) if (!reachable.has(id)) {
                writes.dropNew(id);
                newBlocks.delete(id);
                delete page.blocks[id];
            }
        }
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
    async function objects(ids: string[]): Promise<void> {
        const page = state.page;
        if (!page) return;
        // Visited objects for this read request only.
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const seen = new Set<string>();
        let needed = [...new Set(ids)];
        while (needed.length) {
            const data = await api.readObjects(pageId, needed);
            needed.forEach(id => seen.add(id));
            page.sharedUses ??= {};
            for (const id of needed) {
                if (data.uses[id]) page.sharedUses[id] = data.uses[id];
                else delete page.sharedUses[id];
            }
            if (data.page) {
                page.attributes = data.page.attributes;
                page.children = data.page.children;
            }
            const children = [...(data.page?.children ?? [])];
            for (const b of data.blocks) {
                page.blocks[b.id] = b;
                children.push(...b.children);
            }
            needed = [...new Set(children.filter(id => !seen.has(id) && !page.blocks[id]))];
        }
    }
    async function reread(ids: string[]): Promise<void> {
        if (!state.page || !ids.length || !await flush()) return;
        await objects(ids);
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
                    if (saved) apply(edit);
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
    async function discard(): Promise<void> {
        if (await ask("放弃本地输入", "重新读取已保存的页面会放弃当前尚未保存的输入。")) {
            writes.clear();
            state.dirty = false;
            state.error = "";
            await refresh();
        }
    }
    async function action(commit: (token?: string) => Promise<CommitResult>): Promise<void> {
        if (!await flush()) return;
        let changed: Changed | undefined;
        if (await confirmed(async token => {
            const result = await commit(token);
            if (result.status === "saved") changed = result.changed;
            return result;
        }) && changed) await reread([...changed.pages.filter(id => id === pageId), ...changed.blocks]);
    }
    const undo = (direction: "undo" | "redo", branch?: string): Promise<void> => action(token => api.undo(tabId, direction, branch, token));
    return {
        state, refresh, reread, objects, flush, save: flush, stage, review, action, discard, undo, composition,
        attr: (id: string, value: AttributeValue) => stage({ blocks: [], attributes: { [id]: copyData(value) } }),
        detach: (id: string) => stage({ blocks: [], detach: [id] }),
        listen(fn: Listener) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}
export function session(tabId: string, pageId: string): PageSession {
    let value = sessions.get(tabId);
    if (!value) {
        value = makeSession(tabId, pageId);
        sessions.set(tabId, value);
    }
    return value;
}
export async function saveAll(): Promise<boolean> {
    window.dispatchEvent(new Event("workspace-flush"));
    for (const value of sessions.values()) if (!await value.flush()) return false;
    try {
        await Promise.all(auxiliary);
    }
    catch (error) {
        knowledgeState.error = message(error);
        return false;
    }
    return true;
}
export async function closeSession(tabId: string): Promise<boolean> {
    window.dispatchEvent(new Event("workspace-flush"));
    const value = sessions.get(tabId);
    if (value && !await value.flush()) {
        knowledgeState.error = "此页面未保存，已保留标签页。请处理页面上显示的错误。";
        return false;
    }
    await window.api.knowledge.closeTab(tabId);
    sessions.delete(tabId);
    return true;
}