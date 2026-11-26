<div class="attribute-input" bind:this={root}>
    {#if definition.type === "file" || definition.type === "files"}
        <FileInput {definition} {value} {session} inline={!!onstage} {onstage} disabled={disabled || !!definition.readonly} {onchange} />
    {:else if isTimeType(definition.type)}
        <DatePicker {label} precision={definition.type} value={typeof value === "number" ? value : null} {zone}
            readonly={disabled || !!definition.readonly} {initiallyOpen} {onchange} />
    {:else if definition.readonly || disabled}
        {#if (definition.type === "page-link" || definition.type === "page-links") && !empty}
            {#each (Array.isArray(value) ? value : [value]) as id (id)}
                <TextButton text={t("property.linkedPage")} onclick={() => services.open(String(id))} />
            {/each}
        {:else if definition.type === "boolean"}
            <Checkbox {label} checked={value === true} disabled hideLabel />
        {:else}
            <span class="readonly">{empty ? t("property.empty") : propertyText(definition, value, zone)}</span>
        {/if}
    {:else if definition.type === "recurrence"}
        {#if value === null}<Button variant="text" onclick={() => onchange({ every: 60, unit: "minute" })}>{t("property.setRefresh")}</Button>
        {:else}<div class="inline">{t("property.every")}<Input label={t("property.interval")} type="number" inputProps={{ min: 15, max: 1440 }}
            value={String(recurrenceMinutes(value) ?? 60)} onchange={raw => onchange({ every: Number(raw), unit: "minute" })} />{t("property.minutes")}</div>{/if}
    {:else if definition.type === "boolean"}
        <Checkbox {label} checked={value === true} hideLabel {onchange} />
    {:else if definition.type === "select" || definition.type === "status"}
        <Select {label} value={empty ? "" : String(value)} placeholder={t("property.empty")} open={initiallyOpen}
            options={[{ value: "", label: t("property.empty") }, ...(definition.metadata.options ?? []).map(option => ({ value: option.id, label: propertyOption(definition, option) }))]}
            onchange={id => onchange(id || emptyValue(definition.type))} />
    {:else if definition.type === "multiselect"}
        <div class="options">
            {#each definition.metadata.options ?? [] as option (option.id)}
                <Checkbox label={propertyOption(definition, option)} checked={Array.isArray(value) && value.includes(option.id)} onchange={checked => {
                    const current = Array.isArray(value) ? value : []; onchange(checked ? [...current, option.id] : current.filter(id => id !== option.id));
                }} />
            {:else}<span class="readonly">{t("property.noOptions")}</span>{/each}
        </div>
    {:else if definition.type === "page-link" || definition.type === "page-links"}
        <div class="options">
            {#each (Array.isArray(value) ? value : typeof value === "string" ? [value] : []) as id (id)}
                <span class="inline"><TextButton text={t("property.openPage")} onclick={() => services.open(String(id))} />
                    <IconButton icon="close" label={t("property.removeItem", { name: t("shell.page") })} onclick={() => onchange(Array.isArray(value) ? value.filter(item => item !== id) : emptyValue(definition.type))} /></span>
            {/each}
            <Button variant="text" onclick={openPicker}>{t("editor.choosePage")}</Button>
        </div>
        {#if picker}
            <TargetPicker mode="page" position={pickerPosition} source={services.picker} onclose={() => picker = false} onselect={target => {
                onchange(definition.type === "page-link" ? target.id : [...new Set([...(Array.isArray(value) ? value : []), target.id])]); picker = false;
            }} />
        {/if}
    {:else if definition.type === "json"}
        <Input {label} multiline={2} value={empty ? "" : JSON.stringify(value, null, 2)} placeholder={t("property.json")}
            onchange={raw => change(() => raw ? JSON.parse(raw) : emptyValue(definition.type))} />
    {:else if definition.type === "number"}
        <Input {label} type="number" value={empty ? "" : String(value)} onchange={raw => onchange(raw ? Number(raw) : emptyValue(definition.type))} />
    {:else}
        <Input {label} multiline={definition.type === "string" ? (definition.id === "paper_abstract" ? 4 : 1) : undefined} value={String(value ?? "")} {onchange} />
    {/if}
    {#if error}<small role="alert">{message(error)}</small>{/if}
</div>

<style>
    .attribute-input { position: relative; min-width: 0; flex: 1; font-size: var(--ui-font-small); }
    .attribute-input > :global(:is(.ui-field, .ui-select, .date-picker-trigger)) { width: 100%; }
    .attribute-input :global(.inline .ui-field) { width: 100%; }
    .attribute-input :global(.date-picker-trigger) { justify-content: flex-start; }
    .readonly { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ui-text-secondary); }
    .inline, .options { display: flex; align-items: center; gap: var(--ui-space-2); min-width: 0; }
    .options { flex-wrap: wrap; }
    small[role="alert"] { display: block; position: absolute; top: 100%; z-index: 1; background: var(--ui-surface-popup); padding: var(--ui-space-1); color: var(--ui-text-danger); font-size: var(--ui-font-small); }
</style>
<script lang="ts">
    import { onMount } from "svelte";
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import { recurrenceMinutes } from "../../../shared/content/timers";
    import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import { isTimeType } from "../../../shared/content/time";
    import { emptyValue, isEmpty } from "../../../shared/attrs/values";
    import { currentTimeZone } from "../layout/preferences.svelte";
    import { propertyControls } from "./property-controls";
    import { propertyName, propertyOption, propertyText } from "./attribute-labels";
    import Button from "../base/Button.svelte";
    import TextButton from "../base/TextButton.svelte";
    import Checkbox from "../base/Checkbox.svelte";
    import Input from "../base/Input.svelte";
    import DatePicker from "../base/DatePicker.svelte";
    import Select from "../base/Select.svelte";
    import IconButton from "../base/IconButton.svelte";
    import FileInput from "./FileInput.svelte";
    import { type PageSession } from "./page-session.svelte";

    import TargetPicker from "./TargetPicker.svelte";
    let { definition, value, disabled = false, session, initiallyOpen = false, onstage, onchange }: {
        definition: AttributeDefinition; value: AttributeValue; disabled?: boolean; session?: PageSession; initiallyOpen?: boolean;
        onstage?: (ids: string[]) => boolean; onchange: (value: AttributeValue) => void;
    } = $props();
    const services = propertyControls(), label = $derived(propertyName(definition));
    const zone = $derived(currentTimeZone());
    const empty = $derived(isEmpty(definition.type, value));
    let picker = $state(false), error = $state<ErrorValue>("");
    let root: HTMLElement;
    let pickerPosition = $state<{ x: number; y: number; left: number; right: number; bottom: number }>();
    function openPicker(): void {
        if (initiallyOpen && root) {
            const bounds = root.getBoundingClientRect();
            pickerPosition = { x: bounds.left, y: bounds.bottom, left: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
        }
        picker = true;
    }
    onMount(() => {
        if (initiallyOpen && (definition.type === "page-link" || definition.type === "page-links")) openPicker();
    });
    function change(read: () => AttributeValue): void {
        try {
            onchange(read());
            error = "";
        }
        catch (problem) {
            error = failure(problem);
        }
    }
</script>