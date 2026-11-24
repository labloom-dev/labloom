<script module lang="ts">
    import type { SelectOption } from "./Select.svelte";
    type Option = Pick<SelectOption, "value" | "label"> & { detail?: string };
</script>

<script lang="ts">
    import { tick } from "svelte";
    import { comboboxShortcuts, isComposingKey } from "../../../shared/content/commands";
    import { t } from "../../i18n.svelte";
    import Icon from "../utils/Icon.svelte";
    import Input from "./Input.svelte";
    import Popover from "./Popover.svelte";
    import VirtualRows from "./VirtualRows.svelte";

    let { label, options, value = $bindable(""), placeholder, disabled = false, onchange }: {
        label: string;
        options: readonly Option[];
        value?: string;
        placeholder?: string;
        disabled?: boolean;
        onchange?: (value: string) => void;
    } = $props();

    const listId = $props.id();
    const rowId = (index: number): string => listId + "-" + index;
    let open = $state(false), query = $state(""), active = $state(-1);
    let triggerButton: HTMLButtonElement;
    let restoreTrigger = true;
    let input = $state<HTMLInputElement>(), rows = $state<ReturnType<typeof VirtualRows<Option>>>();
    const selected = $derived(options.find(option => option.value === value));
    const matches = $derived.by(() => {
        const text = query.trim().toLowerCase();
        return text ? options.filter(option => option.label.toLowerCase().includes(text)) : options;
    });

    function show(event: Event): void {
        event.preventDefault();
        restoreTrigger = true;
        active = Math.max(0, options.findIndex(option => option.value === value));
        input?.focus({ preventScroll: true });
        void tick().then(() => {
            if (open) rows?.reveal(active);
        });
    }

    function restore(event: Event): void {
        event.preventDefault();
        if (restoreTrigger) triggerButton?.focus({ preventScroll: true });
    }

    function filter(text: string): void {
        query = text;
        active = 0;
        rows?.reset();
    }

    function setOpen(next: boolean): void {
        open = next;
        if (!next) query = "";
    }

    function choose(option: Option): void {
        value = option.value;
        setOpen(false);
        onchange?.(value);
    }

    function keys(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const key = event.key;
        if (key === comboboxShortcuts.select) {
            if (matches[active] && !event.repeat) choose(matches[active]);
        }
        else if (key === comboboxShortcuts.next || key === comboboxShortcuts.previous) {
            active = Math.max(0, Math.min(matches.length - 1, active + (key === comboboxShortcuts.next ? 1 : -1)));
            rows?.reveal(active);
        }
        else return;
        event.preventDefault();
        event.stopPropagation();
    }
</script>

<Popover {label} bind:open={() => open, setOpen}
    contentProps={{ class: "combobox-popup", onOpenAutoFocus: show, onCloseAutoFocus: restore, onInteractOutside: () => restoreTrigger = false }}>
    {#snippet trigger({ props })}
        <button {...props} bind:this={triggerButton} type="button" class="ui-control ui-select" aria-label={label} {disabled} data-placeholder={!selected || undefined}>
            <span class="ui-select-label">{selected?.label ?? placeholder ?? ""}{#if selected?.detail}<span class="detail">&nbsp;{selected.detail}</span>{/if}</span>
            <Icon name="chevron-down" size="var(--ui-icon-small)" />
        </button>
    {/snippet}
    <div class="filter">
        <Input label={t("combobox.filter")} placeholder={t("combobox.filter")} value={query} bind:input oninput={filter}
            inputProps={{ role: "combobox", "aria-expanded": open, "aria-controls": listId, "aria-autocomplete": "list",
                "aria-activedescendant": rows?.shows(active) ? rowId(active) : undefined, onkeydown: keys }} />
    </div>
    <VirtualRows items={matches} id={listId} role="listbox" aria-label={label} itemKey={option => option.value} bind:this={rows}>
        {#snippet row(option, index)}
            <button id={rowId(index)} type="button" role="option" tabindex="-1" class="ui-menu-item"
                aria-selected={value === option.value} aria-setsize={matches.length} aria-posinset={index + 1}
                data-highlighted={active === index || undefined} onpointermove={() => active = index}
                onpointerdown={event => event.preventDefault()} onclick={() => choose(option)}>
                <span class="ui-menu-label">{option.label}{#if option.detail}<span class="detail">&nbsp;{option.detail}</span>{/if}</span>
                {#if value === option.value}<Icon name="check" size="var(--ui-icon-normal)" />{/if}
            </button>
        {/snippet}
    </VirtualRows>
    {#if !matches.length}<div class="empty" role="status">{t("combobox.empty")}</div>{/if}
</Popover>

<style>
    :global(.combobox-popup.ui-popover) {
        display: flex;
        flex-direction: column;
        width: var(--bits-popover-anchor-width);
        padding: var(--ui-space-2);
        overflow: hidden;
    }
    :global(.combobox-popup > .virtual-rows) { max-height: calc(9 * var(--ui-row-height)); }
    .filter { flex: none; margin-bottom: var(--ui-space-2); }
    .filter :global(.ui-field) { display: flex; }
    .ui-menu-item { height: var(--ui-row-height); text-align: start; }
    .detail, .empty { color: var(--ui-text-secondary); }
    .ui-menu-item[data-highlighted] .detail { color: inherit; }
    .empty { padding: var(--ui-space-2) var(--ui-space-3); }
</style>