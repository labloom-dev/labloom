<div class="group-header" class:focused={tabState.focusedGroupId === group.id} bind:this={header} role="presentation" ondragover={acceptTabDrop} ondrop={event => dropTab(event, group.id)} onwheel={wheel} ondblclick={event => {
    if (event.target instanceof Element && !event.target.closest(".tab,button")) {
        focusGroup(group.id); createPage();
    }
}}>
    <Tabs.List class="tab-list">
        {#each group.tabs as tab (tab.id)}
            <ContextActions className="tab-context" items={tabMenu(tab.id)}>
                <div class="tab" class:active={group.activeTabId === tab.id} draggable="true" role="presentation" onmousedown={event => {
                    if (event.button === 1) event.preventDefault();
                }} ondragstart={event => startDrag(event, tab.id)} ondrop={event => dropOnTab(event, tab.id)} onauxclick={event => {
                    if (event.button === 1) {
                        event.preventDefault(); removeTab(tab.id);
                    }
                }}>
                    <Tabs.Trigger value={tab.id} onclick={() => {
                        activateTab(tab.id); if (tab.type === "page") void focusEditor(tab.id);
                    }}>
                        <span>{tab.title}</span>{#if tabDirty(tab.id)}<span class="dirty" aria-label="未保存">●</span>{/if}{#if slowTabs.has(tab.id)}<span class="sync-mark" role="status" aria-label="正在同步">↻</span>{/if}
                    </Tabs.Trigger>
                    <button class="close-tab" aria-label={`关闭${tab.title}`} title={`关闭${tab.title}`} onclick={event => {
                        event.stopPropagation(); removeTab(tab.id);
                    }}><Icon name="close" size={12} /></button>
                </div>
            </ContextActions>
        {/each}
    </Tabs.List>
    <button class="group-tool" title={commands.splitRight.label + " (" + commands.splitRight.shortcut + ")"} aria-label="向右拆分" onclick={() => split("horizontal")}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html split_right}
    </button>
    <button class="group-tool" title={commands.splitDown.label} aria-label="向下拆分" onclick={() => split("vertical")}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html split_down}
    </button>
    <button class="group-tool" title="合并标签组" aria-label="合并标签组" disabled={tabState.groups.length === 1} onclick={merge}><Icon name="close" size={12} /></button>
</div>
<style>
    .group-header { display: flex; align-items: center; flex-shrink: 0; height: var(--tabbar-height); background: var(--c-tab-header-background); border-bottom: var(--border-width) solid var(--c-tab-header-border); }
    .group-header > :global(.tab-list) { display: flex; align-items: stretch; align-self: stretch; overflow-x: auto; min-width: 0; flex: 1; scrollbar-width: none; }
    :global(.tab-context) { display: flex; flex-shrink: 0; }
    .tab { display: flex; align-items: center; position: relative; border-top: 2px solid transparent; color: var(--c-muted); }
    .tab.active { border-top-color: var(--c-accent); background: var(--c-paper); color: var(--c-ink); }
    .tab :global([data-tabs-trigger]) { display: flex; align-items: center; gap: 5px; min-width: 80px; max-width: 210px; height: calc(var(--tabbar-height) - 3px); padding: 0 30px 0 12px; font-size: var(--font-body); }
    .tab :global([data-tabs-trigger] > span:first-child) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dirty, .sync-mark { font-size: var(--font-min); }
    button { display: grid; place-items: center; width: var(--button-height); height: var(--button-height); flex-shrink: 0; border-radius: var(--control-radius); color: var(--c-muted); }
    button:hover:not(:disabled) { background: var(--c-gold-light); color: var(--c-ink); }
    button :global(svg) { width: 15px; height: 15px; }
    .close-tab { position: absolute; right: 3px; opacity: 0; }
    .tab:hover .close-tab, .tab.active .close-tab, .tab:focus-within .close-tab { opacity: 1; }
</style>
<script lang="ts">
    import Icon from "../utils/Icon.svelte";
    import ContextActions from "../utils/ContextActions.svelte";
    import type { XYDirection } from "../types";
    import { acceptTabDrop, dropTab, focusTabGroup, tabDragType } from "./interactions";
    import { Tabs } from "bits-ui";
    import { tick } from "svelte";
    import type { TabGroup, TabID } from "./defs";
    import { activateTab, closeGroup, focusGroup, removeTab } from "./api";
    import { createPage, splitCurrent } from "../layout/navigation";
    import { commands } from "../../../shared/content/commands";
    import { tabState } from "./state.svelte";
    import { slowTabs, visits } from "./activity.svelte";
    import { tabDirty } from "./dirty.svelte";
    import split_right from "../../assets/custom--split-right.svg?raw";
    import split_down from "../../assets/custom--split-down.svg?raw";
    let { group }: { group: TabGroup } = $props();
    let header = $state<HTMLDivElement | null>(null);
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
    async function merge(): Promise<void> {
        if (closeGroup(group.id)) {
            await tick(); focusTabGroup(tabState.focusedGroupId);
        }
    }
    function wheel(event: WheelEvent): void {
        const list = header?.querySelector(".tab-list");
        if (list && list.scrollWidth > list.clientWidth) {
            event.preventDefault(); list.scrollLeft += event.deltaY || event.deltaX;
        }
    }
    function tabMenu(id: TabID): { label: string; shortcut?: string; run: () => void }[] {
        return [
            {
                label: "关闭", shortcut: commands.closeTab.shortcut, run: () => {
                    removeTab(id);
                }
            },
            {
                label: "关闭其他", run: () => {
                    for (const tab of [...group.tabs]) if (tab.id !== id) removeTab(tab.id);
                }
            },
            {
                label: "关闭右侧", run: () => {
                    for (const tab of group.tabs.slice(group.tabs.findIndex(tab => tab.id === id) + 1)) removeTab(tab.id);
                }
            },
            {
                label: "向右拆分", shortcut: commands.splitRight.shortcut, run: () => {
                    void split("horizontal", id);
                }
            },
            {
                label: "向下拆分", run: () => {
                    void split("vertical", id);
                }
            }
        ];
    }
</script>