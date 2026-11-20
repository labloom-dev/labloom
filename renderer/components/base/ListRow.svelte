<script lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import IconButton from "./IconButton.svelte";

    type Action = { icon: IconName; label: string; shortcut?: string; disabled?: boolean; onclick: () => void };
    let { icon, title, description, selected = false, focused = false, dragOver = false, actions = [], onclick, ...attributes }: {
        icon: IconName;
        title: string;
        description?: string;
        selected?: boolean;
        focused?: boolean;
        dragOver?: boolean;
        actions?: Action[];
        onclick?: () => void;
    } & Pick<HTMLAttributes<HTMLDivElement>, "ondragover" | "ondragleave" | "ondrop"> = $props();
</script>

<div class="ui-row" data-selected={selected || undefined} data-focused={focused || undefined} data-drag-over={dragOver || undefined} {...attributes}>
    <button type="button" class="ui-row-main" aria-pressed={selected} {onclick}>
        <Icon name={icon} size="var(--ui-icon-normal)" />
        <span class="ui-row-title">{title}</span>
        {#if description}<span class="ui-row-description">{description}</span>{/if}
    </button>
    {#if actions.length}
        <span class="ui-row-actions">
            {#each actions as action (action)}<IconButton {...action} />{/each}
        </span>
    {/if}
</div>