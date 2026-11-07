import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
import { type ContentBlock, type Mutation, type PageRecord } from "../../../shared/types/content";
import { type HistoryState } from "../../../shared/types/knowledge";

export const knowledgeState = $state({ revision: 0, error: "", busy: false });
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
export async function mutate(input: Mutation): Promise<boolean> {
    const command = copyData(input);
    let result = await window.api.knowledge.mutate(command);
    while (result.status === "confirmation") {
        const preview = result.preview;
        if (!await ask("确认本次更改", `将删除 ${preview.removed.length} 个对象，并将 ${preview.recycled.length} 个失去保留关系的页面移入回收站。`, [...preview.removed, ...preview.recycled].map(item => item.title))) return false;
        result = await window.api.knowledge.mutate(command, preview.token);
    }
    knowledgeState.revision++;
    return true;
}
export async function define(id: string, value: AttributeDefinition | null): Promise<boolean> {
    let impact = await window.api.knowledge.define(id, value);
    while (impact) {
        if (!await ask("修改共享属性", `以下页面的属性值会被清空、移除或调整。${impact.recycled?.length ? `同时有 ${impact.recycled.length} 个页面失去保留关系，将进入回收站。` : ""}`, [...impact.pages, ...(impact.recycled ?? [])].map(page => page.title))) return false;
        impact = await window.api.knowledge.define(id, value, impact.token);
    }
    knowledgeState.revision++;
    return true;
}

const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export const copyData = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export type PageSession = {
    state: { page: PageRecord | null; loading: boolean; saving: boolean; dirty: boolean; error: string; history: HistoryState };
    refresh(): Promise<void>; save(): Promise<boolean>; changed(): void; block(value: ContentBlock): void;
    attr(id: string, value: AttributeValue): void; detach(id: string): void; children(id: string, ids: string[], added?: ContentBlock[]): void;
    discard(): Promise<void>; undo(direction: "undo" | "redo", branch?: string): Promise<void>; composition(active: boolean): void;
};
// This registry is not rendered; each session carries its own reactive state.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const sessions = new Map<string, PageSession>();
// Pending writes are awaited at navigation boundaries, never rendered.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const auxiliary = new Set<Promise<unknown>>();
export function trackWrite(promise: Promise<unknown>): void {
    auxiliary.add(promise);
    void promise.finally(() => auxiliary.delete(promise)).catch(() => {});
}

function makeSession(tabId: string, pageId: string): PageSession {
    const state = $state<{ page: PageRecord | null; loading: boolean; saving: boolean; dirty: boolean; error: string; history: HistoryState }>({ page: null, loading: true, saving: false, dirty: false, error: "", history: { canUndo: false, redo: [] } });
    let base: PageRecord | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<boolean> | undefined;
    let loadId = 0;
    let composing = false;
    function composition(active: boolean): void {
        composing = active;
        if (active) clearTimeout(timer);
        else if (state.dirty) changed();
    }

    async function refresh(): Promise<void> {
        const request = ++loadId;
        state.loading = true;
        try {
            if (state.dirty && !await save()) return;
            const [page, history] = await Promise.all([window.api.knowledge.get(pageId), window.api.knowledge.history(tabId)]);
            if (request !== loadId) return;
            base = copyData(page);
            state.page = page;
            state.history = history;
            state.error = "";
        }
        catch (error) {
            state.error = message(error);
        }
        finally {
            if (request === loadId) state.loading = false;
        }
    }
    function changed(): void {
        state.dirty = true;
        clearTimeout(timer);
        if (!composing) timer = setTimeout(() => {
            void save();
        }, 600);
    }
    function block(value: ContentBlock): void {
        if (!state.page || state.loading || state.saving) return;
        state.page.blocks[value.id] = value;
        changed();
    }
    function attr(id: string, value: AttributeValue): void {
        if (!state.page || state.loading || state.saving) return;
        state.page.attributes[id] = value;
        changed();
    }
    function detach(id: string): void {
        if (!state.page || state.loading || state.saving) return;
        delete state.page.attributes[id];
        changed();
    }
    function children(containerId: string, ids: string[], added: ContentBlock[] = []): void {
        if (!state.page || state.loading || state.saving) return;
        for (const value of added) state.page.blocks[value.id] = value;
        if (containerId === pageId) state.page.children = ids;
        else state.page.blocks[containerId].children = ids;
        changed();
    }
    async function save(): Promise<boolean> {
        clearTimeout(timer);
        if (pending) return pending;
        if (composing) return false;
        if (!state.dirty || !state.page || !base) return true;
        const original = base, submitted = copyData(state.page);
        state.saving = true;
        pending = (async () => {
            try {
                const ok = await mutate({ type: "edit", edit: { pageId, tabId, version: original.version,
                    ...(equal(original.children, submitted.children) ? {} : { children: submitted.children }),
                    blocks: Object.values(submitted.blocks).filter(block => !equal(original.blocks[block.id], block)).map(value => ({ value, version: original.blockVersions[value.id] ?? null })),
                    attributes: Object.fromEntries(Object.entries(submitted.attributes).filter(([id, value]) => !equal(original.attributes[id], value))),
                    detach: Object.keys(original.attributes).filter(id => !Object.hasOwn(submitted.attributes, id)) } });
                if (!ok) {
                    state.error = "更改尚未保存。可以重试或放弃本地输入。";
                    return false;
                }
                const fresh = await window.api.knowledge.get(pageId);
                base = copyData(fresh);
                state.page = fresh;
                state.dirty = false;
                state.error = "";
                state.history = await window.api.knowledge.history(tabId);
                return true;
            }
            catch (error) {
                state.error = message(error);
                return false;
            }
            finally {
                state.saving = false;
                pending = undefined;
            }
        })();
        return pending;
    }
    async function discard(): Promise<void> {
        if (await ask("放弃本地输入", "将重新读取已保存的页面；当前尚未保存的输入会被放弃。")) {
            state.dirty = false;
            state.error = "";
            await refresh();
        }
    }
    async function undo(direction: "undo" | "redo", branch?: string): Promise<void> {
        if (!await save()) return;
        if (direction === "undo" ? !state.history.canUndo : !state.history.redo.length) return;
        try {
            await window.api.knowledge.undo(tabId, direction, branch);
            await refresh();
            knowledgeState.revision++;
        }
        catch (error) {
            state.error = message(error);
        }
    }
    return { state, refresh, save, changed, block, attr, detach, children, discard, undo, composition };
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
    for (const value of sessions.values()) if (!await value.save()) return false;
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
    if (value && !await value.save()) {
        knowledgeState.error = "此页面未保存，已保留标签页。请处理页面上显示的错误。";
        return false;
    }
    await window.api.knowledge.closeTab(tabId);
    sessions.delete(tabId);
    return true;
}