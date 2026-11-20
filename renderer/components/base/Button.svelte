<script lang="ts">
    import type { HTMLButtonAttributes } from "svelte/elements";
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import "./controls.css";

    let { variant = "secondary", icon, children, type = "button", class: className, ...attributes }: HTMLButtonAttributes & {
        variant?: "primary" | "secondary" | "text" | "danger";
        icon?: IconName;
    } = $props();
</script>

<button {...attributes} {type} class={["ui-control", className]} data-variant={variant}>
    {#if icon}<Icon name={icon} size="var(--ui-icon-normal)" />{/if}
    {@render children?.()}
</button>