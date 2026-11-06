import type { PageRecord, SavePageInput } from "../../../shared/types/knowledge";
import { tabState } from "../Tab/state.svelte";

export const readingNavigation = $state<{ target: { pageId: string; attachmentId: string; pageNumber: number } | null }>({ target: null });
export const knowledgeState = $state({ version: 0, operation: "", notice: "", error: "", locked: false });
type Session = { page: PageRecord | null; dirty: boolean; saving: boolean; error: string; sequence: number };
export const sessions = $state<Record<string, Session>>({});
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, Promise<boolean>>();
const loading = new Map<string, Promise<void>>();

export function changed(): void { knowledgeState.version++; }

export async function perform(label: string, action: () => Promise<void>, lock = false): Promise<void> {
    if (knowledgeState.operation) return;
    knowledgeState.operation = label;
    knowledgeState.error = "";
    knowledgeState.notice = "";
    knowledgeState.locked = lock;
    try { await action(); changed(); }
    catch (error) { knowledgeState.error = error instanceof Error ? error.message : "操作失败，请重试。"; }
    finally { knowledgeState.operation = ""; knowledgeState.locked = false; }
}

export async function loadPage(id: string, refresh = false): Promise<void> {
    sessions[id] ??= { page: null, dirty: false, saving: false, error: "", sequence: 0 };
    if (sessions[id].dirty || sessions[id].saving || (!refresh && sessions[id].page)) return;
    if (loading.has(id)) return loading.get(id)!;
    const request = (async () => {
        const sequence = sessions[id].sequence;
        try {
            const page = await window.api.knowledge.get(id);
            if (sessions[id].sequence === sequence && !sessions[id].dirty) {
                sessions[id].page = page;
                sessions[id].error = "";
                updateTitle(page);
            }
        }
        catch (error) { sessions[id].error = error instanceof Error ? error.message : "页面加载失败。"; }
    })();
    loading.set(id, request);
    try { await request; }
    finally { loading.delete(id); }
}

function updateTitle(page: PageRecord): void {
    for (const group of tabState.groups) {
        for (const tab of group.tabs) if (tab.type === "page" && tab.pageId === page.id) tab.title = page.title;
    }
}

export function editPage(id: string, patch: Partial<SavePageInput>): void {
    const session = sessions[id];
    if (!session?.page || session.page.deleted) return;
    Object.assign(session.page, patch);
    session.sequence++;
    session.dirty = true;
    updateTitle(session.page);
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => { timers.delete(id); void savePage(id); }, 650));
}

export function hasPendingChanges(): boolean {
    return Object.values(sessions).some(session => session.dirty || session.saving);
}

export async function savePage(id: string): Promise<boolean> {
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (pending.has(id)) return pending.get(id)!;
    const session = sessions[id];
    if (!session?.page || !session.dirty) return true;
    const request = (async () => {
        session.saving = true;
        session.error = "";
        try {
            while (session.dirty && session.page) {
                const sequence = session.sequence;
                // Electron cannot clone a Svelte proxy. Pass a plain snapshot through IPC.
                const page = $state.snapshot(session.page);
                const saved = await window.api.knowledge.save(page);
                if (sequence === session.sequence) {
                    session.page = saved;
                    session.dirty = false;
                }
                else {
                    session.page.revision = saved.revision;
                    session.page.updatedAt = saved.updatedAt;
                }
                updateTitle(session.page);
                changed();
            }
            return true;
        }
        catch (error) {
            session.error = error instanceof Error ? error.message : "保存失败，当前输入仍保留在页面中。";
            return false;
        }
        finally { session.saving = false; }
    })();
    pending.set(id, request);
    try { return await request; }
    finally { pending.delete(id); }
}

export async function saveAll(): Promise<boolean> {
    const results = await Promise.all(Object.keys(sessions).map(savePage));
    return results.every(Boolean);
}

export function acceptPage(page: PageRecord): void {
    sessions[page.id] = { page, dirty: false, saving: false, error: "", sequence: 0 };
    updateTitle(page);
}