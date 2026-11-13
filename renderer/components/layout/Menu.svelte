<Menubar.Root class="menubar">
    {#each menus as menu (menu.label)}
        <Menubar.Menu>
            <Menubar.Trigger class="app-menu" onpointerdown={rememberFocus}>{menu.label}</Menubar.Trigger>
            <Menubar.Portal>
                <Menubar.Content class="compact-menu" sideOffset={0} align="start" collisionPadding={4}>
                    {#each menu.items as id (id)}
                        <Menubar.Item class="compact-item" onSelect={() => runCommand(id)}>{commands[id].label}<kbd>{commands[id].shortcut}</kbd></Menubar.Item>
                    {/each}
                </Menubar.Content>
            </Menubar.Portal>
        </Menubar.Menu>
    {/each}
</Menubar.Root>
<style>
    :global(.menubar) { display: flex; flex-shrink: 0; }
    :global(.app-menu) { height: var(--button-height); padding-inline: 8px; border-radius: var(--control-radius); font-size: var(--font-body); }
    :global(.app-menu:hover), :global(.app-menu[data-state=open]) { background: var(--c-gold-light); }
</style>
<script lang="ts">
    import { Menubar } from "bits-ui";
    import { menus } from "../../../shared/content/commands";
    import { commands, rememberFocus, runCommand } from "./commands";
</script>