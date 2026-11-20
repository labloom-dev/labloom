<script lang="ts">
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import Tooltip from "./Tooltip.svelte";

    let { icon, label, shortcut, pressed, disabled = false, onclick }: {
        icon: IconName;
        label: string;
        shortcut?: string;
        pressed?: boolean;
        disabled?: boolean;
        onclick?: (event: MouseEvent) => void;
    } = $props();
</script>

<Tooltip text={label} {shortcut}>
    {#snippet trigger({ props })}
        <button {...props} type="button" class="ui-control ui-icon-button" aria-label={label} aria-pressed={pressed} {disabled} onclick={event => {
            if (typeof props.onclick === "function") props.onclick(event);
            onclick?.(event);
        }}>
            <Icon name={icon} size="var(--ui-icon-normal)" />
        </button>
    {/snippet}
</Tooltip>