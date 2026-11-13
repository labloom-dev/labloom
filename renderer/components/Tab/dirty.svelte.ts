import { SvelteMap } from "svelte/reactivity";
export const dirtyPages = new SvelteMap<string, string>();
export const tabDirty = (tabId: string): boolean => [...dirtyPages.values()].includes(tabId);