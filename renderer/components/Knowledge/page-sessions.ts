import { type HistorySource } from "../../../shared/history/ipc";
import { LabloomError } from "../../../shared/failure";
import { failure } from "../../i18n.svelte";
import { visits } from "../Tab/activity.svelte";
import { makeSession, type PageSession } from "./page-session.svelte";
import { knowledgeState } from "./feedback.svelte";
import { sessionKey } from "./session-views";
import { pendingWrites, trackWrite } from "./write-tracker";

const sessions = new Map<string, PageSession>();
export function session(tabId: string, pageId: string, source: HistorySource): PageSession {
    const key = sessionKey(tabId, pageId);
    let value = sessions.get(key);
    if (!value) {
        value = makeSession(tabId, pageId, source, write, () => sessions.delete(key));
        sessions.set(key, value);
    }
    return value;
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