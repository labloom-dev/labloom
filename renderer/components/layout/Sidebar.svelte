<nav class="activity" aria-label="主导航">
    {#each destinations.filter(item => ["overview", "feed", "library", "papers", "calendar"].includes(item.type)) as item (item.type)}
        <button class:active={sameView(activeView, destinationViews[item.type])} aria-label={title(item.type)} title={tooltip(item.type)} onclick={() => openView(destinationViews[item.type])}><Icon name={item.icon} size={20} /></button>
    {/each}
    <button class="settings" class:active={sameView(activeView, destinationViews.settings)} aria-label={title("settings")} title={tooltip("settings")} onclick={() => openDestination("settings")}><Icon name="settings-gear" size={20} /></button>
</nav>
{#if !shell.collapsed}
    <aside class="left-panel" style:width={shell.width + "px"}>
        <header><span>知识库</span></header>
        <input class="filter" type="search" placeholder="筛选标题…" aria-label="筛选标题" bind:value={filter} />
        <div class="groups">
            <SidebarGroup title="固定" query={{ pinned: true }} keyword={applied} initiallyOpen />
            {#each tags as tag (tag.id)}<SidebarGroup title={tag.name} query={{ tags: [tag.id] }} keyword={applied} />{/each}
            <SidebarGroup title="全部独立页" query={{ attributes: { independent: true } }} keyword={applied} initiallyOpen />
        </div>
    </aside>
    <Resizer direction="vertical" thickness={4} origin={shell.width} min={minPanelWidth} max={maxPanelWidth} changeCB={value => {
        shell.width = value; persistPanel();
    }} />
{/if}
<style>
    .activity { display: flex; flex-direction: column; flex: 0 0 var(--activity-width); width: var(--activity-width); background: var(--c-sidebar-background); border-right: var(--border-width) solid var(--c-line); }
    .activity button { display: grid; place-items: center; width: var(--activity-width); height: var(--activity-width); color: var(--c-muted); border-left: 2px solid transparent; }
    .activity button:hover { background: var(--c-cream); }
    .activity button.active { border-color: var(--c-accent); color: var(--c-ink); background: var(--c-gold-light); }
    .settings { margin-top: auto; }
    .left-panel { display: flex; flex-direction: column; flex-shrink: 0; min-width: 0; min-height: 0; background: var(--c-sidebar-background); font-size: var(--font-body); }
    header { display: flex; align-items: center; justify-content: space-between; height: var(--tabbar-height); flex-shrink: 0; padding-inline: var(--panel-indent); }
    .filter { height: var(--button-height); min-width: 0; margin: 0 var(--panel-indent) 4px; padding-inline: 6px; border: var(--border-width) solid var(--c-line); border-radius: var(--control-radius); background: var(--c-paper); color: inherit; font: inherit; }
    .groups { overflow: auto; flex: 1; min-height: 0; }
</style>
<script lang="ts">
    import { get } from "svelte/store";
    import { definitionFor } from "../Tab/views";
    import { onMount } from "svelte";
    import { tabState } from "../Tab/state.svelte";
    import Icon from "../utils/Icon.svelte";
    import Resizer from "../utils/Resizer.svelte";
    import SidebarGroup from "./SidebarGroup.svelte";
    import { destinations, destinationViews, sameView, openView, openDestination } from "./navigation";
    import { commands, type Command } from "../../../shared/content/commands";
    import { minPanelWidth, maxPanelWidth } from "../../../shared/settings/defaults";
    import { shell, persistPanel } from "./shell.svelte";
    let tags = $state<{ id: string; name: string }[]>([]), filter = $state(""), applied = $state("");
    const group = $derived(tabState.groups.find(group => group.id === tabState.focusedGroupId));
    const activeView = $derived(group?.tabs.find(tab => tab.id === group.activeTabId)?.view);
    const title = (type: keyof typeof destinationViews): string => {
        const view = destinationViews[type];
        return get(definitionFor(view.type).title(view.params));
    };
    const tooltip = (type: string): string => {
        const item = commands[type as Command]; return item ? item.label + (item.shortcut ? ` (${item.shortcut})` : "") : type;
    };
    $effect(() => {
        const value = filter; const timer = setTimeout(() => applied = value, 200); return () => clearTimeout(timer);
    });
    onMount(() => {
        let live = true;
        const load = (): void => {
            void window.api.attributes.definitions().then(definitions => {
                if (live) tags = definitions.find(item => item.id === "tags")?.metadata.options ?? [];
            });
        };
        load();
        const off = window.api.pages.onChanged(change => {
            if (change.definition === "tags") load();
        });
        return () => {
            live = false; off();
        };
    });
</script>