import { tick } from "svelte";
import type { GroupID, TabID } from "./defs";
import { activateTab, addTab, getTabID, moveTab } from "./api";
import { tabState } from "./state.svelte";

export const tabDragType = "application/x-labloom-tab";

export function acceptTabDrop(event: DragEvent): boolean {
    if (!event.dataTransfer?.types.includes(tabDragType)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    return true;
}

export function focusTabGroup(groupId: GroupID): void {
    const group = document.querySelector(`[data-group-id="${CSS.escape(groupId)}"]`);
    const target = group?.querySelector<HTMLElement>("[data-tabs-trigger][data-state='active']")
        ?? group?.querySelector<HTMLElement>("[data-open-overview]");
    target?.focus();
}

export async function openOverviewInGroup(groupId: GroupID): Promise<void> {
    if (!addTab(groupId, { id: getTabID(), title: "我的花园", type: "overview" })) return;
    await tick();
    focusTabGroup(groupId);
}

/** The insertion boundary is measured before removing the dragged tab. */
export async function dropTab(event: DragEvent, groupId: GroupID, boundary?: number): Promise<void> {
    if (!acceptTabDrop(event)) return;
    event.stopPropagation();
    const id = event.dataTransfer!.getData(tabDragType) as TabID;
    const group = tabState.groups.find(group => group.id === groupId);
    if (!group) return;
    let index = boundary ?? group.tabs.length;
    const previousIndex = group.tabs.findIndex(tab => tab.id === id);
    if (previousIndex >= 0 && previousIndex < index) index--;
    if (!moveTab(id, groupId, index)) return;
    activateTab(id);
    await tick();
    focusTabGroup(groupId);
}