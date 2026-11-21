<script lang="ts">
    import { tick } from "svelte";
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import type { AttributeDefinition, AttributeValue } from "../../../shared/types/attributes";
    import { copyData } from "../copy-data";
    import { propertyControls } from "./property-controls";
    import Popover from "../base/Popover.svelte";
    import IconButton from "../base/IconButton.svelte";
    import SearchList from "../globalSearch/SearchList.svelte";
    let { definition, value, disabled = false, onchange }: { definition: AttributeDefinition; value: AttributeValue; disabled?: boolean; onchange: (value: AttributeValue) => void } = $props();
    const services = propertyControls();
    let query = $state(""), open = $state(false), busy = $state(false), error = $state<ErrorValue>(""), input = $state<HTMLInputElement>();
    const options = $derived(definition.metadata.options ?? []), selected = $derived(Array.isArray(value) ? value : []);
    const chosen = $derived(options.filter(option => selected.includes(option.id)));
    const rows = $derived.by(() => {
        const name = query.trim(), matches = options.filter(option => !selected.includes(option.id) && option.name.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
        const result = matches.map(item => ({ id: item.id, title: item.name, create: false }));
        if (name && !options.some(item => item.name === name)) result.push({ id: "new:" + name, title: t("property.createTag", { name }), create: true });
        return result;
    });
    async function choose(index: number): Promise<void> {
        const row = rows[index];
        if (!row || disabled || busy) return;
        busy = true;
        try {
            const tag = row.create ? { id: crypto.randomUUID(), name: query.trim() } : row;
            if (row.create && !await services.saveDefinition({ ...copyData(definition), metadata: { ...copyData(definition.metadata), options: [...copyData(options), { id: tag.id, name: query.trim() }] } })) return;
            onchange([...selected, tag.id]); open = false; error = "";
        }
        catch (problem) {
            error = failure(problem);
        }
        finally {
            busy = false;
        }
    }
</script>

<div class="tags-input">
    {#each chosen as option (option.id)}<span class="capsule">{option.name}<IconButton icon="close" label={t("property.removeItem", { name: option.name })} disabled={disabled || busy} onclick={() => onchange(selected.filter(id => id !== option.id))} /></span>{/each}
    <Popover label={t("attributeName.tags")} bind:open contentProps={{ class: "property-picker", onOpenAutoFocus: event => {
        event.preventDefault(); query = ""; void tick().then(() => input?.focus());
    } }}>
        {#snippet trigger({ props })}<IconButton {...props} icon="add" label={t("property.addTag")} {disabled} />{/snippet}
        <SearchList bind:query bind:input options={rows} label={t("property.addTag")} onchoose={choose} />
    </Popover>
    {#if error}<span role="alert">{message(error)}</span>{/if}
</div>

<style>
    .tags-input, .capsule { display: flex; align-items: center; gap: var(--ui-space-1); }
    .tags-input { flex-wrap: wrap; }
    .capsule { padding-left: var(--ui-space-2); border-radius: var(--ui-radius-control); background: var(--ui-selected-inactive); }
    .capsule :global(.ui-icon-button) { width: var(--ui-icon-large); height: var(--ui-icon-large); }
    [role="alert"] { color: var(--ui-danger); }
</style>