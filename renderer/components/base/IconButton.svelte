<script lang="ts">
    import { mergeProps } from "bits-ui";
    import { type HTMLButtonAttributes } from "svelte/elements";
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import Tooltip from "./Tooltip.svelte";

    let { icon, label, shortcut, pressed, size = "var(--ui-icon-normal)", class: className, ...attributes }: HTMLButtonAttributes & {
        icon: IconName;
        label: string;
        shortcut?: string;
        pressed?: boolean;
        size?: string;
    } = $props();
</script>

<Tooltip text={label} {shortcut}>
    {#snippet trigger({ props })}
        <button {...mergeProps(props, attributes)} type="button" class={["ui-control ui-icon-button", className]} aria-label={label} aria-pressed={pressed}>
            <Icon name={icon} {size} />
        </button>
    {/snippet}
</Tooltip>