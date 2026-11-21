<script lang="ts">
    import { Checkbox } from "bits-ui";
    import Icon from "../utils/Icon.svelte";
    import "./controls.css";

    let { label, hideLabel = false, checked = $bindable(false), indeterminate = $bindable(false), disabled = false, onchange }: {
        label: string; hideLabel?: boolean;
        checked?: boolean;
        indeterminate?: boolean;
        disabled?: boolean;
        onchange?: (checked: boolean) => void;
    } = $props();
    let pointerFocus = $state(false);
</script>

<Checkbox.Root class="ui-check" aria-label={hideLabel ? label : undefined} bind:checked bind:indeterminate {disabled} onCheckedChange={onchange}
    data-pointer={pointerFocus || undefined} onpointerdown={() => pointerFocus = true}
    onkeydown={() => pointerFocus = false} onblur={() => pointerFocus = false}>
    <span class="ui-check-mark">
        {#if indeterminate || checked}<Icon name={indeterminate ? "dash" : "check"} size="var(--ui-icon-small)" />{/if}
    </span>
    {#if !hideLabel}{label}{/if}
</Checkbox.Root>