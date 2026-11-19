import type { HistorySource } from "../../../shared/history/ipc";
import type { HistoryState } from "../../../shared/types/knowledge";
import { knowledgeState } from "./feedback.svelte";
import { failure } from "../../i18n.svelte";

type Listener = (state: HistoryState) => void;
type Watch = { source: HistorySource; listeners: Set<Listener>; revision: number; state?: HistoryState };
const watches = new Map<string, Watch>();
const key = (source: HistorySource): string => source.kind === "page" ? "page:" + source.id : "workspace";
let unsubscribe: (() => void) | undefined;

async function read(watch: Watch): Promise<void> {
    const revision = ++watch.revision;
    try {
        const state = await window.api.history.state(watch.source);
        if (watch.revision !== revision) return;
        watch.state = state;
        for (const listener of watch.listeners) listener(state);
    }
    catch (error) {
        if (watch.revision === revision && watch.listeners.size) knowledgeState.error = failure(error);
    }
}
export function watchHistory(source: HistorySource, receive: Listener): () => void {
    unsubscribe ??= window.api.history.onChanged(sources => {
        for (const source of sources) {
            const watch = watches.get(key(source));
            if (watch) void read(watch);
        }
    });
    const id = key(source);
    let watch = watches.get(id);
    if (!watch) {
        watch = { source, listeners: new Set(), revision: 0 };
        watches.set(id, watch);
        void read(watch);
    }
    watch.listeners.add(receive);
    if (watch.state) receive(watch.state);
    return () => {
        watch.listeners.delete(receive);
        if (!watch.listeners.size) watches.delete(id);
        if (!watches.size) {
            unsubscribe?.();
            unsubscribe = undefined;
        }
    };
}