<div class="group-header" class:focused={tabState.focusedGroupId === group.id} bind:this={header} ondragover={acceptTabDrop} ondrop={event => dropTab(event, group.id)}>
    <Tabs.List class="tab-list">
        {#each group.tabs as tab (tab.id)}
            <div class="tab" class:active={group.activeTabId === tab.id} draggable="true" role="presentation" ondragstart={event => startDrag(event, tab.id)} ondrop={event => dropOnTab(event, tab.id)}>
                <Tabs.Trigger value={tab.id} onclick={() => {
                    if (tab.type === "page") void focusEditor(tab.id);
                }}>{tab.title}{#if slowTabs.has(tab.id)}<span class="sync-mark" role="status" aria-label="正在同步" title="正在同步">↻</span>{/if}</Tabs.Trigger>
                <button class="close-tab" aria-label={`关闭${tab.title}`} title={`关闭${tab.title}`} onclick={event => closeTab(event, tab.id)}>
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html close_svg}
                </button>
            </div>
        {/each}
    </Tabs.List>

    <button class="group-tool" title="打开总览" aria-label="打开总览" data-open-overview bind:this={addButton} onclick={() => openOverviewInGroup(group.id)}>
        <Icon name="plus" size={15} />
    </button>
    <button class="group-tool" title="左右分栏" aria-label="左右分栏" onclick={() => split("horizontal")}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html split_right}
    </button>
    <button class="group-tool" title="上下分栏" aria-label="上下分栏" onclick={() => split("vertical")}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html split_down}
    </button>
    <button class="group-tool" title="合并分栏" aria-label="合并分栏" disabled={tabState.groups.length === 1} onclick={merge}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html close_svg}
    </button>
</div>


<style>
    .group-header {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        min-height: 45px;
        gap: 5px;
        padding: 7px 12px 0;
        background: var(--c-tab-header-background);
        border-bottom: 1px solid var(--c-tab-header-border);
    }
    .group-header.focused {
        border-bottom-color: var(--c-accent);
    }
    .group-header > :global(.tab-list) {
        display: flex;
        align-items: stretch;
        align-self: stretch;
        overflow-x: auto;
        min-width: 0;
        flex: 1;
        gap: 5px;
        scrollbar-width: none;
    }
    .tab {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        gap: 4px;
        padding: 0 7px 0 13px;
        border: 1px solid transparent;
        border-bottom: 0;
        border-radius: 9px 9px 0 0;
        color: var(--c-muted);
    }
    .sync-mark { margin-left: 4px; color: var(--c-muted); font-size: 10px; }
    .tab.active {
        border-color: var(--c-tab-header-border);
        background: var(--c-paper);
        color: var(--c-ink);
    }
    .tab :global([data-tabs-trigger]) {
        max-width: 180px;
        height: 35px;
        padding-right: 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 700;
    }
    button {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        flex-shrink: 0;
        border-radius: 6px;
        color: var(--c-muted);
    }
    button:hover:not(:disabled) {
        background: var(--c-gold-light);
        color: var(--c-ink);
    }
    button :global(svg) {
        width: 15px;
        height: 15px;
    }
    .close-tab {
        width: 20px;
        height: 20px;
    }
    .close-tab :global(svg) {
        width: 12px;
        height: 12px;
    }
    .group-tool {
        margin-bottom: 6px;
    }
</style>


<script lang="ts">
    import Icon from "../utils/Icon.svelte";
    import type { XYDirection } from "../types";
    import { acceptTabDrop, dropTab, focusTabGroup, openOverviewInGroup, tabDragType } from "./interactions";
    import { Tabs } from "bits-ui";
    import { tick } from "svelte";
    import type { TabGroup, TabID } from "./defs";
    import { closeGroup, removeTab, splitGroup } from "./api";
    import { tabState } from "./state.svelte";
    import { slowTabs, visits } from "./activity.svelte";
    import split_right from "../../assets/custom--split-right.svg?raw";
    import split_down from "../../assets/custom--split-down.svg?raw";
    import close_svg from "../../assets/carbon--close.svg?raw";

    let { group }: { group: TabGroup } = $props();
    let header = $state<HTMLDivElement | null>(null);
    let addButton = $state<HTMLButtonElement | null>(null);

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
        if (!event.dataTransfer) return;
        event.dataTransfer.setData(tabDragType, id);
        event.dataTransfer.effectAllowed = "move";
    }

    function dropOnTab(event: DragEvent, id: TabID): void {
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const after = event.clientX >= bounds.left + bounds.width / 2;
        void dropTab(event, group.id, group.tabs.findIndex(tab => tab.id === id) + Number(after));
    }

    async function split(direction: XYDirection): Promise<void> {
        const id = splitGroup(group.id, direction);
        if (!id) return;
        await tick();
        focusTabGroup(id);
    }

    async function merge(): Promise<void> {
        if (!closeGroup(group.id)) return;
        await tick();
        focusTabGroup(tabState.focusedGroupId);
    }

    async function closeTab(event: MouseEvent, id: TabID): Promise<void> {
        const button = event.currentTarget as HTMLButtonElement;
        const restoreFocus = button.parentElement?.contains(document.activeElement);
        if (!removeTab(id) || !restoreFocus) return;
        await tick();
        const activeTrigger = header?.querySelector<HTMLButtonElement>("[data-tabs-trigger][data-state='active']");
        (activeTrigger ?? addButton)?.focus();
    }
</script>