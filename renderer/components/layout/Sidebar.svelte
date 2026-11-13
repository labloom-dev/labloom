<nav class="activity" aria-label="主导航">
    {#each destinations.filter(item => ["overview", "feed", "library", "papers", "calendar"].includes(item.type)) as item (item.type)}
        <button class:active={activeType === item.type} aria-label={item.title} title={tooltip(item.type)} onclick={() => openDestination(item.type)}><Icon name={item.icon} size={20} /></button>
    {/each}
    <button class="settings" class:active={activeType === "settings"} aria-label="偏好设置" title={tooltip("settings")} onclick={() => openDestination("settings")}><Icon name="settings" /></button>
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
    <Resizer direction="vertical" thickness={4} origin={shell.width} min={170} max={500} changeCB={value => {
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
    import { onMount } from "svelte";
    import { tabState } from "../Tab/state.svelte";
    import Icon from "../utils/Icon.svelte";
    import Resizer from "../utils/Resizer.svelte";
    import SidebarGroup from "./SidebarGroup.svelte";
    import { destinations, openDestination } from "./navigation";
    import { commands, type Command } from "../../../shared/content/commands";
    import { shell, persistPanel } from "./shell.svelte";
    let tags = $state<{ id: string; name: string }[]>([]), filter = $state(""), applied = $state("");
    const activeType = $derived(tabState.groups.find(group => group.id === tabState.focusedGroupId)?.tabs.find(tab => tab.id === tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId)?.type);
    const tooltip = (type: string): string => {
        const item = commands[type as Command]; return item ? item.label + (item.shortcut ? ` (${item.shortcut})` : "") : type;
    };
    $effect(() => {
        const value = filter; const timer = setTimeout(() => applied = value, 200); return () => clearTimeout(timer);
    });
    onMount(() => {
        let live = true;
        const load = (): void => {
            void window.api.knowledge.definitions().then(definitions => {
                if (live) tags = definitions.find(item => item.id === "tags")?.metadata.options ?? [];
            });
        };
        load();
        const off = window.api.knowledge.onChanged(change => {
            if (change.definition === "tags") load();
        });
        return () => {
            live = false; off();
        };
    });
</script>