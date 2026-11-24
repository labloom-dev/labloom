<script lang="ts">
    import { mergeProps } from "bits-ui";
    import { type HTMLButtonAttributes } from "svelte/elements";
    import { type IconName } from "../utils/Icon.svelte";
    import Button from "./Button.svelte";
    import Tooltip from "./Tooltip.svelte";

    let { text, suffix = "", icon, class: className, ...attributes }: Omit<HTMLButtonAttributes, "children"> & {
        text: string; suffix?: string; icon?: IconName;
    } = $props();

    let label: HTMLSpanElement;
</script>

<Tooltip text={text + suffix} canOpen={() => label.scrollWidth > label.clientWidth}>
    {#snippet trigger({ props })}
        <Button {...mergeProps(props, attributes)} class={["ui-text-button", className]} variant="text" {icon}>
            <span class="label" bind:this={label}>{text}</span>{#if suffix}<span class="suffix">{suffix}</span>{/if}
        </Button>
    {/snippet}
</Tooltip>

<style>
    :global(.ui-control.ui-text-button) { min-width: 0; max-width: 100%; justify-content: flex-start; text-align: start; }
    :global(.ui-text-button > .icon) { flex: none; }
    .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .suffix { flex: 0 0 auto; max-width: 100%; white-space: normal; color: var(--ui-text-secondary); }
</style>