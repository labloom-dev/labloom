import { SvelteMap } from "svelte/reactivity";
import type { MenuItem } from "../base/Menu.svelte";

const menus = new SvelteMap<string, () => MenuItem[]>();

export function viewMenu(tabId: string): MenuItem[] {
    return menus.get(tabId)?.() ?? [];
}

export function registerViewMenu(tabId: string, menu: () => MenuItem[]): () => void {
    menus.set(tabId, menu);
    return () => {
        if (menus.get(tabId) === menu) menus.delete(tabId);
    };
}