<script module lang="ts">
    import type { IconName } from "../utils/Icon.svelte";
    type MenuCommand = {
        label: string;
        icon?: IconName;
        shortcut?: string;
        disabled?: boolean;
        checked?: boolean;
        onselect: () => void;
    };
    type Submenu = { label: string; icon?: IconName; disabled?: boolean; items: MenuItem[] };
    export type MenuItem = MenuCommand | Submenu | { separator: true };
</script>

<script lang="ts">
    import { ContextMenu, DropdownMenu } from "bits-ui";
    import Icon from "../utils/Icon.svelte";
    import "./controls.css";

    let { items, trigger, context = false, open = $bindable(false) }: {
        items: MenuItem[];
        trigger: NonNullable<DropdownMenu.TriggerProps["child"]>;
        context?: boolean;
        open?: boolean;
    } = $props();

    function contextKey(event: KeyboardEvent): void {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }));
    }
</script>

{#snippet caption(item: MenuCommand | Submenu)}
    <span class="ui-menu-leading">
        {#if item.icon}<Icon name={item.icon} size="var(--ui-icon-normal)" />
        {:else if "checked" in item && item.checked}<Icon name="check" size="var(--ui-icon-normal)" />{/if}
    </span>
    <span class="ui-menu-label">{item.label}</span>
    {#if item.icon && "checked" in item && item.checked}<Icon name="check" size="var(--ui-icon-normal)" />{/if}
    {#if "items" in item}<Icon name="chevron-right" size="var(--ui-icon-small)" />
    {:else if item.shortcut}<kbd class="ui-shortcut">{item.shortcut}</kbd>{/if}
{/snippet}

{#snippet entries(list: MenuItem[])}
    {#each list as item (item)}
        {#if "separator" in item}
            <DropdownMenu.Separator class="ui-menu-separator" />
        {:else if "items" in item}
            <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger class="ui-menu-item" disabled={item.disabled} textValue={item.label}>{@render caption(item)}</DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.SubContent class="ui-popup ui-menu" data-context={context || undefined} sideOffset={2} collisionPadding={8} loop>
                        {@render entries(item.items)}
                    </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
            </DropdownMenu.Sub>
        {:else if item.checked !== undefined}
            <DropdownMenu.CheckboxItem class="ui-menu-item" checked={item.checked} disabled={item.disabled} textValue={item.label} onSelect={item.onselect}>{@render caption(item)}</DropdownMenu.CheckboxItem>
        {:else}
            <DropdownMenu.Item class="ui-menu-item" disabled={item.disabled} textValue={item.label} onSelect={item.onselect}>{@render caption(item)}</DropdownMenu.Item>
        {/if}
    {/each}
{/snippet}

{#if context}
    <ContextMenu.Root bind:open>
        <ContextMenu.Trigger tabindex={0} onkeydown={contextKey} child={trigger} />
        <ContextMenu.Portal>
            <ContextMenu.Content class="ui-popup ui-menu" data-context="" collisionPadding={8} loop>{@render entries(items)}</ContextMenu.Content>
        </ContextMenu.Portal>
    </ContextMenu.Root>
{:else}
    <DropdownMenu.Root bind:open>
        <DropdownMenu.Trigger child={trigger} />
        <DropdownMenu.Portal>
            <DropdownMenu.Content class="ui-popup ui-menu" sideOffset={4} collisionPadding={8} loop>{@render entries(items)}</DropdownMenu.Content>
        </DropdownMenu.Portal>
    </DropdownMenu.Root>
{/if}