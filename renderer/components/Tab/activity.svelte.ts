import { SvelteSet } from "svelte/reactivity";
import { TabVisits } from "./visits";
import { knowledgeState, message } from "../Knowledge/feedback.svelte";

export const readingTabs = new SvelteSet<string>();
export const slowTabs = new SvelteSet<string>();
// Timeout handles are only used to cancel the delayed indicator.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearIndicator(id: string): void {
    clearTimeout(timers.get(id));
    timers.delete(id);
    slowTabs.delete(id);
}
export const visits = new TabVisits((id, locked) => {
    if (locked) {
        if (timers.has(id)) return;
        readingTabs.add(id);
        timers.set(id, setTimeout(() => slowTabs.add(id), 300));
    }
    else {
        clearIndicator(id);
        readingTabs.delete(id);
    }
}, problem => {
 knowledgeState.error = message(problem);
}, clearIndicator);