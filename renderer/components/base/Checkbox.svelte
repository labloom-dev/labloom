<script lang="ts">
    import { Checkbox } from "bits-ui";
    import type { HTMLButtonAttributes } from "svelte/elements";
    import Icon from "../utils/Icon.svelte";
    import "./controls.css";

    let { label, hideLabel = false, checked = $bindable(false), indeterminate = $bindable(false), disabled = false, onclick, onchange }: {
        label: string; hideLabel?: boolean;
        checked?: boolean;
        indeterminate?: boolean;
        disabled?: boolean;
        onclick?: HTMLButtonAttributes["onclick"];
        onchange?: (checked: boolean) => void;
    } = $props();
    let pointerFocus = $state(false);
</script>

<Checkbox.Root class="ui-check" aria-label={hideLabel ? label : undefined} bind:checked bind:indeterminate {disabled} onCheckedChange={onchange}
    {onclick} data-pointer={pointerFocus || undefined} onpointerdown={() => pointerFocus = true}
    onkeydown={() => pointerFocus = false} onblur={() => pointerFocus = false}>
    <span class="ui-check-mark">
        {#if indeterminate || checked}<Icon name={indeterminate ? "dash" : "check"} size="var(--ui-icon-small)" />{/if}
    </span>
    {#if !hideLabel}{label}{/if}
</Checkbox.Root>