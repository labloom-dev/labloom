import { tabState } from "./state.svelte";
import { restoreTabState } from "./restore";

export async function restoreTabs(): Promise<void> {
    window.api.app.editorStarted();
    const state = restoreTabState(await window.api.workspace.loadTabs());
    if (state) Object.assign(tabState, state);
}
export function persistTabs(): Promise<void> {
    return window.api.workspace.saveTabs($state.snapshot(tabState));
}