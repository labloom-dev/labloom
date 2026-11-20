<TabBar focused={tabState.focusedGroupId === group.id} canMerge={tabState.groups.length > 1} hasTabs={!!group.tabs.length}
    onsplit={down => void split(down ? "vertical" : "horizontal")} onmerge={() => {
        focusGroup(group.id); runCommand("mergeGroup");
    }}
    oncloseall={() => closeTabs(group.tabs)} oncreate={() => {
        focusGroup(group.id); createPage();
    }}
    ondragover={acceptTabDrop} ondrop={event => void dropTab(event, group.id)}>
    {#each group.tabs as tab (tab.id)}
        {@const title = fromStore(definitionFor(tab.view.type).title(tab.view.params))}
        {@const kind = tab.view.type === "page" ? fromStore(pageKind(tab.view.params.page.id)) : null}
        <TabItem id={tab.id} title={title.current} icon={kind ? kindIcons[kind.current] : viewIcon(tab.view)}
            active={tab.id === group.activeTabId} dirty={tabDirty(tab.id)} syncing={slowTabs.has(tab.id)} menu={tabMenu(tab.id)}
            onactivate={() => {
                activateTab(tab.id); if (tab.view.type === "page") void focusEditor(tab.id);
            }}
            onclose={() => removeTab(tab.id)} ondragstart={event => startDrag(event, tab.id)} ondrop={event => dropOnTab(event, tab.id)} />
    {/each}
</TabBar>

<script lang="ts">
    import TabBar from "./TabBar.svelte";
    import TabItem from "./TabItem.svelte";
    import { type MenuItem } from "../base/Menu.svelte";
    import { type IconName } from "../utils/Icon.svelte";
    import { kindIcons } from "../Knowledge/labels";
    import { destinationIcons } from "../layout/destinations";
    import { commandLabel, t } from "../../i18n.svelte";
    import { runCommand } from "../layout/commands";
    import { pageKind } from "./page-titles";
    import type { XYDirection } from "../types";
    import { acceptTabDrop, dropTab, focusTabGroup, tabDragType } from "./interactions";
    import { tick } from "svelte";
    import { type Tab, type TabGroup, type TabID } from "./defs";
    import { activateTab, focusGroup, removeTab } from "./api";
    import { createPage, splitCurrent } from "../layout/navigation";
    import { commands } from "../../../shared/content/commands";
    import { fromStore } from "svelte/store";
    import { definitionFor } from "./views";
    import { tabState } from "./state.svelte";
    import { slowTabs, visits } from "./activity.svelte";
    import { tabDirty } from "./dirty.svelte";

    let { group }: { group: TabGroup } = $props();
    function viewIcon(view: Tab["view"]): IconName {
        if (view.type === "page") return kindIcons.editable;
        return destinationIcons[view.type === "library" && view.params.pageType?.type === "paper" ? "papers" : view.type];
    }
    async function focusEditor(id: TabID): Promise<void> {
        await tick();
        const selector = `[data-tabs-content][data-value="${CSS.escape(id)}"] .tiptap`;
        if (!document.querySelector(selector)) {
            if (!await visits.settled(id)) return;
            await tick();
            if (document.activeElement?.closest<HTMLElement>("[data-tabs-content]")?.dataset.value === id) return;
        }
        if (tabState.focusedGroupId === group.id && group.activeTabId === id)
            document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }
    function startDrag(event: DragEvent, id: TabID): void {
        if (event.dataTransfer) {
            event.dataTransfer.setData(tabDragType, id); event.dataTransfer.effectAllowed = "move";
        }
    }
    function dropOnTab(event: DragEvent, id: TabID): void {
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        void dropTab(event, group.id, group.tabs.findIndex(tab => tab.id === id) + Number(event.clientX >= bounds.left + bounds.width / 2));
    }
    async function split(direction: XYDirection, tabId = group.activeTabId): Promise<void> {
        if (tabId) activateTab(tabId);
        const id = splitCurrent(group.id, direction);
        if (id) {
            await tick(); focusTabGroup(id);
        }
    }
    function closeTabs(tabs: Tab[]): void {
        for (const tab of [...tabs]) removeTab(tab.id);
    }
    function tabMenu(id: TabID): MenuItem[] {
        return [
            { label: t("shell.close"), shortcut: commands.closeTab.shortcut, onselect: () => removeTab(id) },
            { label: t("shell.closeOthers"), onselect: () => closeTabs(group.tabs.filter(tab => tab.id !== id)) },
            { label: t("shell.closeRight"), onselect: () => closeTabs(group.tabs.slice(group.tabs.findIndex(tab => tab.id === id) + 1)) },
            { label: commandLabel("splitRight"), shortcut: commands.splitRight.shortcut, onselect: () => void split("horizontal", id) },
            { label: commandLabel("splitDown"), onselect: () => void split("vertical", id) }
        ];
    }
</script>