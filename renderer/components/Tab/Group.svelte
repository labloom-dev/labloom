{#if group}
    <section
        class="group"
        data-group-id={groupId}
        aria-label="标签页分栏"
        ondragover={acceptTabDrop}
        ondrop={event => dropTab(event, groupId)}
        onpointerdowncapture={focusPane}
        onfocusin={() => focusGroup(groupId)}
    >
        <Tabs.Root
            class="group-root"
            bind:value={getActiveTab, setActiveTab}
        >
            <GroupHeader {group} />
            <div class="group-content" {@attach element => {
                const observer = new ResizeObserver(entries => element.style.setProperty("--pane-height", entries[0].contentRect.height + "px"));
                observer.observe(element); return () => observer.disconnect();
            }}>
                {#if !group.tabs.length}
                    <div class="empty-group"><img src={icon} alt="labloom" /><p>{commands.newPage.label} {commands.newPage.shortcut}</p><p>{commands.search.label} {commands.search.shortcut}</p><p>{commands.settings.label} {commands.settings.shortcut}</p></div>
                {/if}
                {#each group.tabs as tab (tab.id)}
                    <Tabs.Content value={tab.id} aria-hidden={group.activeTabId !== tab.id} tabindex={group.activeTabId === tab.id ? 0 : -1}>
                        {#if group.activeTabId === tab.id || visitedTabs.has(tab.id)}
                            <Content {tab} />
                        {/if}
                    </Tabs.Content>
                {/each}
            </div>
        </Tabs.Root>
    </section>
{/if}


<style>
    .group {
        display: flex;
        flex: 1;
        overflow: hidden;
        min-width: 0;
        min-height: 0;

        & > :global(.group-root) {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-width: 0;
            min-height: 0;
        }
    }
    .group-content {
        position: relative;
        flex: 1;
        overflow: clip;
        min-height: 0;
        background-color: var(--c-cream);
        background-image: radial-gradient(var(--c-dots, #d9cfb9) .85px, transparent .85px);
        background-size: 18px 18px;

        & > :global([data-tabs-content]) {
            position: absolute;
            inset: 0;
            overflow: auto;
            contain: layout paint;
        }
        /* Keep the layout and scroll position of visited documents between tab clicks. */
        & > :global([data-tabs-content][hidden]) {
            display: block;
            transform: translateX(-100%);
        }
    }
    .empty-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: 30px;
        text-align: center;
    }
    .empty-group img { width: 80px; filter: grayscale(1); opacity: .22; margin-bottom: 16px; }
    .empty-group p { margin: 4px 0; color: var(--c-muted); font-size: var(--font-body); }
</style>


<script lang="ts">
    import { acceptTabDrop, dropTab } from "./interactions";
    import icon from "../../assets/icon.png";
    import { commands } from "../../../shared/content/commands";
    import { Tabs } from "bits-ui";
    import GroupHeader from "./GroupHeader.svelte";
    import Content from "./Content.svelte";
    import type { GroupID } from "./defs";
    import { activateTab, focusGroup } from "./api";
    import { tabState, visitedTabs } from "./state.svelte";

    let { groupId }: { groupId: GroupID } = $props();
    const group = $derived(tabState.groups.find(group => group.id === groupId));
    $effect.pre(() => {
        const tab = group?.tabs.find(tab => tab.id === group.activeTabId);
        if (tab && ["page", "library", "papers", "calendar"].includes(tab.type)) visitedTabs.add(tab.id);
    });

    function focusPane(event: PointerEvent): void {
        const control = document.activeElement;
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
            if (control.closest("[data-group-id]")?.getAttribute("data-group-id") !== groupId && control !== event.target) control.blur();
        }
        const trigger = event.target instanceof Element && event.target.closest<HTMLElement>("[data-tabs-trigger]");
        const tab = trigger && group?.tabs.find(item => item.id === trigger.dataset.value);
        if (tab) activateTab(tab.id); else focusGroup(groupId);
    }

    function getActiveTab(): string {
        return group?.activeTabId ?? "";
    }

    function setActiveTab(value: string): void {
        const tab = group?.tabs.find(tab => tab.id === value);
        if (tab) activateTab(tab.id);
    }
</script>