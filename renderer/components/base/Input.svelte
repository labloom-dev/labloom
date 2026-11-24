<script lang="ts">
    import { type HTMLInputAttributes } from "svelte/elements";
    import Icon from "../utils/Icon.svelte";
    import "./controls.css";
    import { fromPointer } from "./modality";

    type Mode = { search: true; clearLabel: string } | { search?: false; clearLabel?: never };
    let { label, value = $bindable(""), placeholder, disabled = false, invalid = false, search, clearLabel, input = $bindable(), inputProps, multiline, type = "text", oninput, onchange }: Mode & {
        label: string;
        value?: string;
        placeholder?: string;
        disabled?: boolean;
        invalid?: boolean;
        input?: HTMLInputElement;
        multiline?: number;
        inputProps?: HTMLInputAttributes;
        type?: HTMLInputAttributes["type"];
        onchange?: (value: string) => void;
        oninput?: (value: string) => void;
    } = $props();
    let pointer = $state(false);
    function clear(): void {
        value = "";
        oninput?.(value);
        input?.focus();
    }
</script>

<span class="ui-field" class:multiline={!!multiline}>
    {#if search}<Icon name="search" size="var(--ui-icon-normal)" />{/if}
    {#if multiline}
        <textarea class="ui-field-input" rows={multiline} aria-label={label} aria-invalid={invalid} {placeholder} {disabled} {value}
            data-pointer={pointer || undefined} onfocus={() => pointer = fromPointer()} onblur={() => pointer = false}
            oninput={event => {
                value = event.currentTarget.value; oninput?.(value);
            }} onchange={event => onchange?.(event.currentTarget.value)}></textarea>
    {:else}
        <input {...inputProps} class="ui-field-input" type={search ? "search" : type} aria-label={label} aria-invalid={invalid}
            {placeholder} {disabled} {value} bind:this={input} data-pointer={pointer || undefined}
            onfocus={() => pointer = fromPointer()} onblur={() => pointer = false}
            onchange={event => {
                inputProps?.onchange?.(event);
                onchange?.(event.currentTarget.value);
            }}
            oninput={event => {
                value = event.currentTarget.value;
                oninput?.(value);
            }} />
    {/if}
    {#if search && value}
        <button class="ui-control ui-icon-button" type="button" aria-label={clearLabel} {disabled} onclick={clear}>
            <Icon name="close" size="var(--ui-icon-small)" />
        </button>
    {/if}
</span>

<style>
    .ui-field.multiline { height: auto; min-height: var(--ui-input-height); }
    .multiline textarea { resize: vertical; min-height: var(--ui-row-height); padding-block: var(--ui-space-1); }
    .multiline:has(textarea:focus-visible:not([data-pointer])) { outline: var(--ui-focus-width) solid var(--ui-focus); outline-offset: var(--ui-focus-offset); }
</style>