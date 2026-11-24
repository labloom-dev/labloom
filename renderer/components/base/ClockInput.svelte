<script lang="ts">
    import { clockInputShortcuts as keys, isComposingKey } from "../../../shared/content/commands";
    import { secondsToMinute } from "../../../shared/content/time";
    import { t } from "../../i18n.svelte";
    import Button from "./Button.svelte";
    import Input from "./Input.svelte";
    import Popover from "./Popover.svelte";

    let { hourOnly, value, selected, invalid, describedBy, oninput, onchange, onoutside }: {
        hourOnly: boolean;
        value: string;
        selected: string;
        invalid: boolean;
        describedBy?: string;
        oninput: (value: string) => void;
        onchange: (value: string) => void;
        onoutside: (event: PointerEvent, field: HTMLInputElement, composing: boolean) => void;
    } = $props();

    const id = $props.id();
    let input = $state<HTMLInputElement>(), hours = $state<HTMLDivElement>(), minutes = $state<HTMLDivElement>();
    let open = $state(false), column = $state<"hour" | "minute">("hour");
    let composing = false;
    const hour = $derived(Number(selected.slice(0, 2))), minute = $derived(Number(selected.slice(3, 5)));
    const label = $derived(t("datePicker.clock"));
    const hourLabels = Array.from({ length: 24 }, (_, index) => secondsToMinute(index * 3600, "UTC").slice(-5));
    const minuteLabels = Array.from({ length: 60 }, (_, index) => secondsToMinute(index * 60, "UTC").slice(-2));
    const active = $derived(open ? id + "-" + column + "-" + (column === "hour" ? hour : minute) : undefined);

    function center(list: HTMLDivElement | undefined, index: number): void {
        const row = list?.firstElementChild?.firstElementChild;
        if (list && row) list.scrollTop = index * row.getBoundingClientRect().height;
    }

    $effect(() => {
        if (open) center(hours, hour);
    });
    $effect(() => {
        if (open) center(minutes, minute);
    });

    function choose(part: "hour" | "minute", index: number): void {
        column = part;
        const nextHour = part === "hour" ? index : hour, nextMinute = part === "minute" ? index : minute;
        onchange(hourLabels[nextHour].slice(0, 3) + minuteLabels[nextMinute]);
    }

    function keydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event)) return;
        if (event.key === keys.apply) {
            event.preventDefault();
            if (!event.repeat && input) onchange(input.value);
            return;
        }
        if (event.key === "Tab") open = false;
        if (!open || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (event.key === keys.up || event.key === keys.down) {
            event.preventDefault();
            const step = event.key === keys.up ? -1 : 1;
            choose(column, column === "hour" ? Math.max(0, Math.min(23, hour + step)) : Math.max(0, Math.min(59, minute + step)));
        }
        else if (!hourOnly && (event.key === keys.left || event.key === keys.right)) {
            event.preventDefault();
            column = event.key === keys.left ? "hour" : "minute";
        }
    }
</script>

<Input {label} bind:input {value} {invalid} placeholder={hourOnly ? "HH:00" : "HH:mm"} {oninput}
    onchange={text => {
        if (!composing) onchange(text);
    }}
    inputProps={{
        role: "combobox", "aria-expanded": open, "aria-haspopup": "dialog", "aria-controls": open ? id : undefined,
        "aria-activedescendant": active, "aria-describedby": describedBy, autocomplete: "off",
        onfocus: () => open = true, onclick: () => open = true, onkeydown: keydown,
        oncompositionstart: () => composing = true, oncompositionend: () => composing = false
    }} />
<Popover {label} bind:open contentProps={{
    class: "clock-popup", role: "dialog", customAnchor: input?.parentElement,
    trapFocus: false, onOpenAutoFocus: event => event.preventDefault(), onCloseAutoFocus: event => event.preventDefault(),
    onInteractOutside: event => {
        if (input) onoutside(event, input, composing);
    }
}}>
    <div {id} class="columns">
        <div class="column" role="listbox" aria-label={t("attributeType.hour")} data-active={column === "hour"} bind:this={hours}>
            {@render options("hour", hourLabels, hour)}
        </div>
        {#if !hourOnly}
            <div class="column" role="listbox" aria-label={t("attributeType.minute")} data-active={column === "minute"} bind:this={minutes}>
                {@render options("minute", minuteLabels, minute)}
            </div>
        {/if}
    </div>
</Popover>

{#snippet options(part: "hour" | "minute", labels: string[], current: number)}
    <div class="options">
        {#each labels as text, index (index)}
            <div role="option" id={id + "-" + part + "-" + index} aria-selected={index === current}>
                <Button class="clock-option" variant={index === current ? "primary" : "text"} tabindex={-1}
                    onpointerdown={event => {
                        if (event.pointerType === "mouse") event.preventDefault();
                    }}
                    onclick={() => choose(part, index)}>{part === "hour" && !hourOnly ? text.slice(0, 2) : text}</Button>
            </div>
        {/each}
    </div>
{/snippet}

<style>
    :global(.clock-popup.ui-popover) { padding: var(--ui-space-1); width: var(--bits-popover-anchor-width); }
    .columns { display: flex; gap: var(--ui-space-1); }
    .column { flex: 1 1 0; min-width: 0; height: calc(7 * var(--ui-row-height)); overflow: auto; overscroll-behavior: contain; }
    .column + .column { border-inline-start: var(--ui-stroke) solid var(--ui-divider); }
    .column[data-active="true"] { background: var(--ui-surface-panel); }
    .options { padding-block: calc(3 * var(--ui-row-height)); }
    .options :global(.clock-option) { display: flex; width: 100%; height: var(--ui-row-height); }
</style>