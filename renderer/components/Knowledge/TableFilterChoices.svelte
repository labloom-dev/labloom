<script lang="ts">
    import { tick } from "svelte";
    import { isComposingKey } from "../../../shared/content/commands";
    import { t } from "../../i18n.svelte";
    import { kindIcons } from "./labels";
    import Popover from "../base/Popover.svelte";
    import Button from "../base/Button.svelte";
    import Input from "../base/Input.svelte";
    import VirtualRows from "../base/VirtualRows.svelte";
    import Icon from "../utils/Icon.svelte";

    type Option = { value: string; label: string; icon?: typeof kindIcons[keyof typeof kindIcons] };
    let { options, values, onchange }: { options: Option[]; values: string[]; onchange: (values: string[]) => void } = $props();
    let open = $state(false), search = $state(""), input = $state<HTMLInputElement>(), list = $state<ReturnType<typeof VirtualRows<Option>>>();
    let highlighted = $state(0);
    const uid = $props.id(), activeId = (i: number): string => uid + "-" + i;
    const found = $derived(options.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
    const selected = $derived(options.filter(option => values.includes(option.value)).map(option => option.label));
    function choose(value: string): void {
        onchange(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
    }
    function keys(event: KeyboardEvent): void {
        if (isComposingKey(event) || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            highlighted = Math.max(0, Math.min(found.length - 1, highlighted + (event.key === "ArrowDown" ? 1 : -1)));
            list?.reveal(highlighted);
        }
        else if (event.key === "Enter" && found[highlighted] && !event.repeat) choose(found[highlighted].value);
        else return;
        event.preventDefault(); event.stopPropagation();
    }
</script>

<Popover label={t("table.value")} bind:open contentProps={{ class: "table-filter-choices", onOpenAutoFocus: event => {
    event.preventDefault();
    search = ""; highlighted = 0; void tick().then(() => input?.focus());
} }}>
    {#snippet trigger({ props })}
        <Button {...props} class="choices" aria-label={t("table.value")} onkeydown={event => {
            if (isComposingKey(event) && (event.key === "Enter" || event.key === " ")) event.preventDefault();
        }}>
            <span>{selected.join(t("table.valueSeparator")) || t("table.value")}</span>
            <Icon name="chevron-down" size="var(--ui-icon-small)" />
        </Button>
    {/snippet}
    <Input search label={t("table.searchOptions")} clearLabel={t("shell.clearFilter")} bind:value={search} bind:input
        oninput={() => {
            highlighted = 0; list?.reset();
        }}
        inputProps={{ role: "combobox", "aria-expanded": open, "aria-controls": uid, "aria-activedescendant": list?.shows(highlighted) ? activeId(highlighted) : undefined, onkeydown: keys }} />
    <VirtualRows items={found} id={uid} role="listbox" aria-label={t("table.value")} aria-multiselectable="true" itemKey={option => option.value} bind:this={list}>
        {#snippet row(option, i)}
            <button id={activeId(i)} type="button" role="option" tabindex="-1" class="ui-menu-item" aria-selected={values.includes(option.value)}
                aria-setsize={found.length} aria-posinset={i + 1} data-highlighted={i === highlighted || undefined}
                onpointermove={() => highlighted = i} onpointerdown={event => event.preventDefault()} onclick={() => choose(option.value)}>
                {#if option.icon}<Icon name={option.icon} size="var(--ui-icon-normal)" />{/if}
                <span class="ui-menu-label">{option.label}</span>
                {#if values.includes(option.value)}<Icon name="check" size="var(--ui-icon-normal)" />{/if}
            </button>
        {/snippet}
    </VirtualRows>
    {#if !found.length}<span class="empty">{t("combobox.empty")}</span>{/if}
</Popover>

<style>
    :global(.table-filter-choices) { min-width: var(--bits-popover-anchor-width); display: flex; flex-direction: column; gap: var(--ui-space-2); }
    :global(.table-filter-choices .virtual-rows) { max-height: calc(9 * var(--ui-row-height)); }
    :global(button.choices) { width: 100%; min-width: 0; justify-content: space-between; }
    :global(button.choices) span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ui-menu-item { height: var(--ui-row-height); text-align: start; }
    .empty { font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
</style>