import { SvelteMap } from "svelte/reactivity";
import { type HistorySource } from "../../../shared/history/ipc";
import { LabloomError } from "../../../shared/failure";
import { failure } from "../../i18n.svelte";
import { visits } from "../Tab/activity.svelte";
import { tabState } from "../Tab/state.svelte";
import { makeSession, type PageSession } from "./page-session.svelte";
import { knowledgeState } from "./feedback.svelte";
import { sessionKey } from "./session-views";
import { pendingWrites, trackWrite } from "./write-tracker";

const sessions = new SvelteMap<string, PageSession>();
export function mountedSession(tabId: string, pageId: string): PageSession | undefined {
    return sessions.get(sessionKey(tabId, pageId));
}
export function session(tabId: string, pageId: string, source: HistorySource): PageSession {
    const key = sessionKey(tabId, pageId);
    let value = sessions.get(key);
    if (!value) {
        value = makeSession(tabId, pageId, source, write, () => sessions.delete(key));
        sessions.set(key, value);
    }
    return value;
}

// An inspector borrows the same page write machinery and releases it after its last edit is saved.
const inspections = new Map<PageSession, number>();
export function inspectPage(tabId: string, pageId: string): { current: PageSession; release(): void } {
    const current = session(tabId, pageId, { kind: "page", id: pageId });
    inspections.set(current, (inspections.get(current) ?? 0) + 1);
    void visits.settled(tabId);
    return { current, release() {
        const count = (inspections.get(current) ?? 1) - 1;
        if (count) {
            inspections.set(current, count);
            return;
        }
        inspections.delete(current);
        const release = (): void => {
            const tab = tabState.groups.flatMap(group => group.tabs).find(tab => tab.id === tabId);
            const ownsPage = tab?.view.type === "page" && tab.view.params.page.id === pageId;
            if (!ownsPage && !inspections.has(current) && mountedSession(tabId, pageId) === current) current.release();
        };
        if (current.state.dirty || current.state.saving) void trackWrite(current.flush()).then(ok => {
            if (ok) release();
            else knowledgeState.error = current.state.error || { kind: "page-unsaved" };
        });
        else release();
    } };
}
export function syncInspected(ids: string[]): void {
    if (!inspections.size) return;
    for (const current of inspections.keys()) {
        if (current.source.kind !== "page" || !ids.includes(current.source.id)) continue;
        for (const other of sessions.values()) if (other.source.kind === "page" && other.source.id === current.source.id) void visits.settled(other.tabId);
    }
}

async function flushPages(): Promise<void> {
    window.dispatchEvent(new Event("workspace-flush"));
    await Promise.all([...sessions.values()].map(async value => {
        // Buffered keystrokes become page edits when a visit finishes reading.
        if (value.input.waiting && (!await visits.settled(value.tabId) || value.input.waiting)) {
            throw new LabloomError({ kind: "page-pending-input" });
        }
        if (!await value.flush()) throw new LabloomError(value.state.error || { kind: "page-composing" });
    }));
}
export function write<T>(action: () => Promise<T>): Promise<T> {
    // Take both barriers before registering this operation, so it cannot wait for itself.
    const ready = Promise.all([flushPages(), ...pendingWrites()]);
    return trackWrite(ready.then(action));
}
export async function saveAll(): Promise<boolean> {
    try {
        do {
            await Promise.all([flushPages(), ...pendingWrites()]);
        } while (pendingWrites().length || [...sessions.values()].some(value => value.state.dirty || value.input.waiting));
        return true;
    }
    catch (error) {
        knowledgeState.error = failure(error);
        return false;
    }
}
export async function closeSession(tabId: string): Promise<boolean> {
    if (!await saveAll()) return false;
    for (const value of sessions.values()) if (value.tabId === tabId) value.release();
    return true;
}