<script lang="ts">
    import { type Snippet } from "svelte";
    import { commands, type Command } from "../../../shared/content/commands";
    import { commandLabel } from "../../i18n.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Menu from "./Menu.svelte";
    import TitleBar from "./TitleBar.svelte";

    let { collapsed, oncommand, disabled, onremember, children }: {
        collapsed: boolean; oncommand: (id: Command) => void; disabled: (id: Command) => boolean;
        onremember?: (origin: Element | null) => void; children: Snippet;
    } = $props();
</script>

<TitleBar class="workspace-titlebar">
    <div class="tools">
        <IconButton icon="layout-sidebar-left" label={commandLabel("sidebar")} shortcut={commands.sidebar.shortcut} pressed={!collapsed} onclick={() => oncommand("sidebar")} />
        <Menu {oncommand} {disabled} {onremember} />
    </div>
    <div class="search-launcher">{@render children()}</div>
</TitleBar>

<style>
    :global(.workspace-titlebar) {
        display: grid;
        grid-template-columns: minmax(max-content, 1fr) minmax(0, var(--ui-search-width)) minmax(var(--system-controls), 1fr);
        column-gap: var(--ui-space-3);
    }
    .tools { display: flex; align-items: center; width: fit-content; -webkit-app-region: no-drag; }
    .search-launcher { min-width: 0; -webkit-app-region: no-drag; }
</style>