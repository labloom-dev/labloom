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
    import { isComposingKey } from "../../../shared/content/commands";
    import { tick } from "svelte";
    import { ContextMenu, DropdownMenu } from "bits-ui";
    import Icon from "../utils/Icon.svelte";
    import "./controls.css";

    let { items, trigger, context = false, anchor, align, portal, first = false, onrestore, open = $bindable(false) }: {
        items: MenuItem[];
        trigger?: NonNullable<DropdownMenu.TriggerProps["child"]>;
        context?: boolean; first?: boolean; portal?: HTMLElement; onrestore?: () => void;
        anchor?: DropdownMenu.ContentProps["customAnchor"];
        align?: DropdownMenu.ContentProps["align"];
        open?: boolean;
    } = $props();

    let content = $state<HTMLElement | null>(null);
    function opened(event: Event): void {
        if (!first) return;
        event.preventDefault();
        void tick().then(() => content?.querySelector<HTMLElement>("[role=\"menuitem\"]:not([data-disabled])")?.focus({ preventScroll: true }));
    }
    function closed(event: Event): void {
        if (onrestore) {
            event.preventDefault(); onrestore();
        }
    }
    function contextKey(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event)) return;
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
                <DropdownMenu.Portal to={portal}>
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
        {#if trigger}<ContextMenu.Trigger tabindex={0} onkeydown={contextKey} child={trigger} />{/if}
        <ContextMenu.Portal to={portal}>
            <ContextMenu.Content class="ui-popup ui-menu" data-context="" onCloseAutoFocus={closed} collisionPadding={8} loop>{@render entries(items)}</ContextMenu.Content>
        </ContextMenu.Portal>
    </ContextMenu.Root>
{:else}
    <DropdownMenu.Root bind:open>
        {#if trigger}<DropdownMenu.Trigger child={trigger} />{/if}
        <DropdownMenu.Portal to={portal}>
            <DropdownMenu.Content class="ui-popup ui-menu" bind:ref={content} customAnchor={anchor} {align} onOpenAutoFocus={opened} onCloseAutoFocus={closed} sideOffset={4} collisionPadding={8} loop>{@render entries(items)}</DropdownMenu.Content>
        </DropdownMenu.Portal>
    </DropdownMenu.Root>
{/if}