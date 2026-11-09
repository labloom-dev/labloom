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
            <div class="group-content">
                {#if !group.tabs.length}
                    <div class="empty-group"><div class="empty-art"><Bloom /></div><h2>留一片空白，给下一个想法。</h2><p>打开一个页面，或开始新的阅读。</p><button class="button primary" onclick={() => openOverviewInGroup(groupId)}>打开总览</button></div>
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
    .empty-art {
        width: min(180px, 70%);
    }
    h2 {
        font-size: 19px;
    }
    p {
        margin: 0 0 24px;
        color: var(--c-muted);
        font-size: 12px;
    }
</style>


<script lang="ts">
    import { acceptTabDrop, dropTab, openOverviewInGroup } from "./interactions";
    import Bloom from "../utils/Bloom.svelte";
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