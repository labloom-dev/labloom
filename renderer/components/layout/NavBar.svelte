<script lang="ts">
    import { type Snippet } from "svelte";
    import { commands, type Command } from "../../../shared/content/commands";
    import { commandLabel } from "../../i18n.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Menu from "./Menu.svelte";

    let { collapsed, oncommand, disabled, onremember, children }: {
        collapsed: boolean; oncommand: (id: Command) => void; disabled: (id: Command) => boolean;
        onremember?: (origin: Element | null) => void; children: Snippet;
    } = $props();
</script>

<header class="titlebar">
    <div class="tools">
        <IconButton icon="layout-sidebar-left" label={commandLabel("sidebar")} shortcut={commands.sidebar.shortcut} pressed={!collapsed} onclick={() => oncommand("sidebar")} />
        <Menu {oncommand} {disabled} {onremember} />
    </div>
    <div class="search-launcher">{@render children()}</div>
</header>

<style>
    .titlebar {
        -webkit-app-region: drag;
        display: grid;
        grid-template-columns: minmax(max-content, 1fr) minmax(0, var(--ui-search-width)) minmax(var(--system-controls), 1fr);
        align-items: center;
        column-gap: var(--ui-space-3);
        height: var(--ui-titlebar-height);
        flex: none;
        --system-controls: max(var(--ui-space-3), calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)));
        padding-left: max(var(--ui-space-3), env(titlebar-area-x, 0px));
        background: var(--ui-titlebar-background);
        color: var(--ui-titlebar-foreground);
        border-bottom: var(--ui-stroke) solid var(--ui-divider);
    }
    .tools { display: flex; align-items: center; width: fit-content; -webkit-app-region: no-drag; }
    .search-launcher { min-width: 0; -webkit-app-region: no-drag; }
</style>