<script lang="ts">
    import { Menubar } from "bits-ui";
    import { menus, commands, type Command } from "../../../shared/content/commands";
    import { commandLabel, t } from "../../i18n.svelte";
    import "../base/controls.css";

    let { oncommand, disabled, onremember }: {
        oncommand: (id: Command) => void;
        disabled: (id: Command) => boolean;
        onremember?: (origin: Element | null) => void;
    } = $props();
</script>

<Menubar.Root class="menubar" aria-label={t("shell.menuBar")}>
    {#each menus as menu (menu.id)}
        <Menubar.Menu>
            <Menubar.Trigger class="ui-control menu-trigger" onpointerdown={() => onremember?.(document.activeElement)} onfocus={event => {
                if (event.relatedTarget instanceof Element && !event.relatedTarget.closest(".menubar,[data-menubar-content]")) onremember?.(event.relatedTarget);
            }}>{t(`menu.${menu.id}`)}</Menubar.Trigger>
            <Menubar.Portal>
                <Menubar.Content class="ui-popup ui-menu" sideOffset={0} align="start" collisionPadding={4} loop>
                    {#each menu.items as id (id)}
                        <Menubar.Item class="ui-menu-item" disabled={disabled(id)} onSelect={() => oncommand(id)}>
                            <span class="ui-menu-leading"></span><span class="ui-menu-label">{commandLabel(id)}</span>
                            {#if commands[id].shortcut}<kbd class="ui-shortcut">{commands[id].shortcut}</kbd>{/if}
                        </Menubar.Item>
                    {/each}
                </Menubar.Content>
            </Menubar.Portal>
        </Menubar.Menu>
    {/each}
</Menubar.Root>

<style>
    :global(.menubar) { display: flex; flex: none; }
    :global(.menu-trigger[data-state="open"]) { background: var(--ui-hover); }
</style>