import { SvelteMap } from "svelte/reactivity";

// A new request can target the same block twice.
export const anchors = new SvelteMap<string, { blockId: string }>();
export function requestAnchor(tabId: string, blockId: string): void {
    anchors.set(tabId, { blockId });
}