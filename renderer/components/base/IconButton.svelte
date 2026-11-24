<script lang="ts">
    import { mergeProps } from "bits-ui";
    import { type HTMLButtonAttributes } from "svelte/elements";
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import Tooltip from "./Tooltip.svelte";

    let { icon, label, shortcut, pressed, badge, size = "var(--ui-icon-normal)", class: className, ...attributes }: HTMLButtonAttributes & {
        icon: IconName;
        label: string;
        shortcut?: string;
        pressed?: boolean;
        badge?: number;
        size?: string;
    } = $props();
</script>

<Tooltip text={label} {shortcut}>
    {#snippet trigger({ props })}
        <button {...mergeProps(props, attributes)} type="button" class={["ui-control ui-icon-button", className]} aria-label={label} aria-pressed={pressed}>
            <Icon name={icon} {size} />
            {#if badge}<span class="badge" aria-hidden="true">{badge}</span>{/if}
        </button>
    {/snippet}
</Tooltip>

<style>
    .badge { position: absolute; inset: var(--ui-space-1) var(--ui-space-1) auto auto; min-width: var(--ui-icon-small); padding-inline: var(--ui-space-1); border-radius: var(--ui-radius-control); color: var(--ui-text-on-accent); background: var(--ui-accent); font-size: var(--ui-font-small); line-height: var(--ui-icon-small); font-variant-numeric: tabular-nums; }
</style>