<script lang="ts">
    import { tick } from "svelte";
    import { datePickerShortcuts as keys, isComposingKey } from "../../../shared/content/commands";
    import {
        dayToSeconds, nowSeconds, secondsToDay, secondsToSecond, timeToSeconds, type TimePrecision
    } from "../../../shared/content/time";
    import { failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "./Button.svelte";
    import ClockInput from "./ClockInput.svelte";
    import IconButton from "./IconButton.svelte";
    import Input from "./Input.svelte";
    import Popover from "./Popover.svelte";
    import { clampPickerDay, movePickerDay, pickerDay, pickerHeading, pickerPageStart, pickerRows, pickerValueText, shiftPickerPage, weekdays } from "./date-picker";

    let { label, precision, value, zone, readonly = false, onchange }: {
        label: string;
        precision: TimePrecision;
        value: number | null;
        zone: string;
        readonly?: boolean;
        onchange?: (value: number | null) => void;
    } = $props();

    const formats = {
        minute: { text: "yyyy-MM-dd HH:mm", pattern: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/ },
        hour: { text: "yyyy-MM-dd HH:00", pattern: /^\d{4}-\d{2}-\d{2} \d{2}:00$/ },
        day: { text: "yyyy-MM-dd", pattern: /^\d{4}-\d{2}-\d{2}$/ },
        month: { text: "yyyy-MM", pattern: /^\d{4}-\d{2}$/ },
        year: { text: "yyyy", pattern: /^\d{4}$/ }
    };
    const defaultClock = "09:00";
    const clockFormat = $derived(precision === "hour" ? "HH:00" : "HH:mm");

    const id = $props.id(), headingId = id + "-heading", errorId = id + "-error", clockErrorId = id + "-clock-error";
    let open = $state(false), now = $state(0), cursor = $state(0);
    let draft = $state<string>(), clockDraft = $state<string>();
    let dateError = $state<ErrorValue | "format">(""), clockError = $state<ErrorValue | "format">("");
    let dateInput = $state<HTMLInputElement>(), grid = $state<HTMLDivElement>();
    let triggerElement: HTMLButtonElement | undefined;
    let composingDate = false, closedOutside = false;

    const timed = $derived(precision === "hour" || precision === "minute");
    const days = $derived(precision !== "year" && precision !== "month");
    const formatted = $derived(value === null ? "" : pickerValueText(precision, value, zone));
    const triggerText = $derived(formatted || t("datePicker.empty"));
    const selected = $derived(value === null ? null : timed ? Date.parse(secondsToDay(value, zone) + "T00:00:00Z") / 1000 : value);
    const today = $derived(pickerDay(precision, Date.parse(secondsToDay(now, zone) + "T00:00:00Z") / 1000));
    const clock = $derived(timed && formatted ? formatted.slice(-5) : defaultClock);
    const page = $derived(pickerPageStart(precision, cursor));
    const heading = $derived(pickerHeading(precision, page));
    const rows = $derived(pickerRows(precision, page));
    const previous = $derived(shiftPickerPage(precision, cursor, -1));
    const next = $derived(shiftPickerPage(precision, cursor, 1));

    function resetDrafts(): void {
        draft = clockDraft = undefined;
        dateError = clockError = "";
    }

    function setOpen(nextOpen: boolean): void {
        if (nextOpen) {
            now = nowSeconds();
            cursor = selected !== null && Number.isFinite(selected) ? pickerDay(precision, clampPickerDay(selected)) : today;
            closedOutside = false;
        }
        composingDate = false;
        resetDrafts();
        open = nextOpen;
    }

    $effect(() => {
        if (readonly && open) setOpen(false);
    });

    function save(nextValue: number | null): void {
        if (nextValue !== value) onchange?.(nextValue);
        resetDrafts();
    }

    function commitDate(): void {
        if (draft === undefined || composingDate) return;
        const text = draft.trim();
        if (!text || text === formatted) {
            save(text ? value : null);
            return;
        }
        if (!formats[precision].pattern.test(text)) {
            dateError = "format";
            return;
        }
        try {
            const parsed = timeToSeconds(precision, text, zone);
            save(parsed);
            cursor = timed ? dayToSeconds(text.slice(0, 10)) : parsed;
        }
        catch (problem) {
            dateError = failure(problem);
        }
    }

    function commitClock(text: string): void {
        const input = text.trim();
        if (value !== null && input === clock) {
            clockDraft = undefined;
            clockError = "";
            return;
        }
        if (!(precision === "hour" ? /^\d{2}:00$/ : /^\d{2}:\d{2}$/).test(input)) {
            clockError = "format";
            return;
        }
        try {
            const date = selected !== null && Number.isFinite(selected) ? selected : cursor;
            save(timeToSeconds(precision, secondsToDay(date) + " " + input, zone));
            cursor = clampPickerDay(date);
        }
        catch (problem) {
            clockError = failure(problem);
        }
    }

    async function focusDay(): Promise<void> {
        await tick();
        grid?.querySelector<HTMLButtonElement>("button[tabindex='0']")?.focus({ preventScroll: true });
    }

    function pick(date: number): void {
        cursor = date;
        try {
            save(date === selected ? value : timed ? timeToSeconds(precision, secondsToDay(date) + " " + clock, zone) : date);
            if (timed) void focusDay();
            else setOpen(false);
        }
        catch (problem) {
            dateError = failure(problem);
        }
    }

    function goToToday(): void {
        now = nowSeconds();
        cursor = today;
    }

    function setNow(): void {
        goToToday();
        if (!timed) save(today);
        else {
            const local = secondsToSecond(now, zone);
            const elapsed = Number(local.slice(-2)) + (precision === "hour" ? Number(local.slice(-5, -3)) * 60 : 0);
            save(now - elapsed);
        }
    }

    function gridKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isComposingKey(event)) return;
        switch (event.key) {
            case keys.left: cursor = movePickerDay(precision, cursor, -1); break;
            case keys.right: cursor = movePickerDay(precision, cursor, 1); break;
            case keys.up: cursor = movePickerDay(precision, cursor, days ? -7 : -3); break;
            case keys.down: cursor = movePickerDay(precision, cursor, days ? 7 : 3); break;
            case keys.previousPage: if (pickerPageStart(precision, previous) !== page) cursor = previous; break;
            case keys.nextPage: if (pickerPageStart(precision, next) !== page) cursor = next; break;
            case keys.today: goToToday(); break;
            case keys.select:
                event.preventDefault();
                if (!event.repeat) pick(cursor);
                return;
            default: return;
        }
        event.preventDefault();
        void focusDay();
    }

    function withEnter(event: KeyboardEvent, commit: () => void): void {
        if (event.key !== keys.select || isComposingKey(event)) return;
        event.preventDefault();
        if (!event.repeat) commit();
    }

    function applyInputBeforeDismiss(event: PointerEvent): void {
        if (event.target instanceof Node && triggerElement?.contains(event.target)) return;
        closedOutside = true;
        if (document.activeElement === dateInput) commitDate();
    }

    function restoreFocus(event: Event): void {
        event.preventDefault();
        if (!closedOutside) triggerElement?.focus({ preventScroll: true });
    }

    function dismissClockOutside(event: PointerEvent, field: HTMLInputElement, composing: boolean): void {
        const target = event.target;
        if (!(target instanceof Node) || field.closest(".date-picker-popup")?.contains(target) || triggerElement?.contains(target)) return;
        if (document.activeElement === field && clockDraft !== undefined && !composing) commitClock(clockDraft);
        applyInputBeforeDismiss(event);
        setOpen(false);
    }
</script>

{#if readonly}
    <span class="readonly">{triggerText}</span>
{:else}
    <Popover {label} bind:open={() => open, setOpen}
        contentProps={{ role: "dialog", class: "date-picker-popup", onInteractOutside: applyInputBeforeDismiss, onCloseAutoFocus: restoreFocus }}>
        {#snippet trigger({ props })}
            <Button {...props} class={["date-picker-trigger", !formatted && "date-picker-empty"]} aria-label={label + " · " + triggerText}
                {@attach (element: HTMLButtonElement) => {
                    triggerElement = element;
                }}>{triggerText}</Button>
        {/snippet}
        <Input {label} bind:input={dateInput} value={draft ?? formatted} placeholder={formats[precision].text} invalid={!!dateError}
            inputProps={{ "aria-describedby": dateError ? errorId : undefined,
                onkeydown: event => withEnter(event, commitDate),
                oncompositionstart: () => composingDate = true, oncompositionend: () => composingDate = false }}
            oninput={raw => {
                draft = raw; dateError = "";
            }} onchange={commitDate} />
        {#if dateError}
            <div id={errorId} class="error" role="alert">{dateError === "format" ? t("datePicker.format", { format: formats[precision].text }) : message(dateError)}</div>
        {/if}

        <div class="navigation">
            <IconButton icon="chevron-left" label={t("datePicker.previous")} shortcut={keys.previousPage} disabled={pickerPageStart(precision, previous) === page} onclick={() => cursor = previous} />
            <div class="heading" id={headingId} aria-live="polite">{heading}</div>
            <IconButton icon="chevron-right" label={t("datePicker.next")} shortcut={keys.nextPage} disabled={pickerPageStart(precision, next) === page} onclick={() => cursor = next} />
            <Button variant="text" class="date-picker-now" onclick={setNow}>{t("datePicker.now")}</Button>
            <Button variant="text" onclick={() => save(null)}>{t("datePicker.clear")}</Button>
        </div>
        <div role="grid" aria-labelledby={headingId} class="grid" class:days bind:this={grid} onkeydown={gridKeydown}>
            {#if days}
                <div class="grid-row weekdays" role="row">
                    {#each weekdays as weekday (weekday)}<div role="columnheader">{t(`datePicker.weekdays.${weekday}`)}</div>{/each}
                </div>
            {/if}
            {#each rows as row, index (index)}
                <div class="grid-row" role="row">
                    {#each row as date, column (column)}
                        {#if date === null}
                            <div role="gridcell" aria-disabled="true"></div>
                        {:else}
                            {@const text = pickerValueText(days ? "day" : precision, date, zone)}
                            {@const isSelected = date === selected}
                            <div role="gridcell" aria-selected={isSelected}>
                                <Button variant={isSelected ? "primary" : "text"} class="date-picker-cell" aria-label={text}
                                    aria-current={date === today ? "date" : undefined} tabindex={date === cursor ? 0 : -1}
                                    data-outside={days && pickerPageStart(precision, date) !== page || undefined} onclick={() => pick(date)}>
                                    {days ? Number(text.slice(-2)) : text}
                                </Button>
                            </div>
                        {/if}
                    {/each}
                </div>
            {/each}
        </div>
        {#if timed}
            <div class="clock">
                <ClockInput hourOnly={precision === "hour"} value={clockDraft ?? clock} selected={clock} invalid={!!clockError}
                    describedBy={clockError ? clockErrorId : undefined} oninput={raw => {
                        clockDraft = raw; clockError = "";
                    }} onchange={commitClock} onoutside={dismissClockOutside} />
                {#if clockError}
                    <div id={clockErrorId} class="error" role="alert">{clockError === "format" ? t("datePicker.format", { format: clockFormat }) : message(clockError)}</div>
                {/if}
            </div>
        {/if}
    </Popover>
{/if}

<style>
    :global(.date-picker-trigger) { font-variant-numeric: tabular-nums; }
    .readonly, :global(.ui-control.date-picker-empty) { color: var(--ui-text-secondary); user-select: none; }
    :global(.date-picker-popup.ui-popover) {
        display: grid;
        gap: var(--ui-space-2);
        width: min(calc(11 * var(--ui-space-6)), calc(100vw - 2 * var(--ui-space-3)));
        padding: var(--ui-space-3);
        font-variant-numeric: tabular-nums;
    }
    .navigation { display: flex; align-items: center; gap: var(--ui-space-1); }
    .heading { flex: 1; text-align: center; font-weight: 600; }
    .grid { --columns: 3; }
    .grid.days { --columns: 7; }
    .grid-row { display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); gap: var(--ui-space-1); }
    .grid-row + .grid-row { margin-block-start: var(--ui-space-1); }
    .weekdays { align-items: center; height: var(--ui-row-height); text-align: center; color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    .grid :global(.date-picker-cell) { width: 100%; height: calc(var(--ui-button-height) + var(--ui-space-2)); padding: 0; }
    .grid :global(.date-picker-cell[data-outside]:not([data-variant="primary"])) { color: var(--ui-text-disabled); }
    .grid :global(.date-picker-cell[aria-current]) { font-weight: 600; }
    .grid :global(.date-picker-cell[aria-current]:not([data-variant="primary"])) { color: var(--ui-accent); }
    .clock { display: grid; gap: var(--ui-space-1); }
    .error { font-size: var(--ui-font-small); color: var(--ui-text-danger); }
</style>