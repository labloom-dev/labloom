<script lang="ts">
    import Icon from "../utils/Icon.svelte";
    import "./controls.css";
    import { fromPointer } from "./modality";

    type Mode = { search: true; clearLabel: string } | { search?: false; clearLabel?: never };
    let { label, value = $bindable(""), placeholder, disabled = false, invalid = false, search, clearLabel, oninput }: Mode & {
        label: string;
        value?: string;
        placeholder?: string;
        disabled?: boolean;
        invalid?: boolean;
        oninput?: (value: string) => void;
    } = $props();
    let input: HTMLInputElement;
    let pointer = $state(false);
    function clear(): void {
        value = "";
        oninput?.(value);
        input.focus();
    }
</script>

<span class="ui-field">
    {#if search}<Icon name="search" size="var(--ui-icon-normal)" />{/if}
    <input class="ui-field-input" type={search ? "search" : "text"} aria-label={label} aria-invalid={invalid}
        {placeholder} {disabled} {value} bind:this={input} data-pointer={pointer || undefined}
        onfocus={() => pointer = fromPointer()} onblur={() => pointer = false}
        oninput={event => {
            value = event.currentTarget.value; oninput?.(value);
        }} />
    {#if search && value}
        <button class="ui-control ui-icon-button" type="button" aria-label={clearLabel} {disabled} onclick={clear}>
            <Icon name="close" size="var(--ui-icon-small)" />
        </button>
    {/if}
</span>