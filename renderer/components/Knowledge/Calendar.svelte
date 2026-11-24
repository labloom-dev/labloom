<script lang="ts">
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import { onDestroy, onMount, untrack } from "svelte";
    import { calendarShortcuts as keys, isComposingKey } from "../../../shared/content/commands";
    import { nowSeconds, secondsToDay, secondsToMinute, secondsToMonth, timeToSeconds } from "../../../shared/content/time";
    import type { AttributeValue, AttributeType } from "../../../shared/types/attributes";
    import type { CalendarPage, CalendarQuery } from "../../../shared/workspace/calendar";
    import { commandLabel, currentLanguage, failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Checkbox from "../base/Checkbox.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Menu, { type MenuItem } from "../base/Menu.svelte";
    import VirtualList from "../base/VirtualList.svelte";
    import { movePickerDay, pickerPageStart, pickerRows, shiftPickerPage, weekdays } from "../base/date-picker";
    import { dragPreview } from "../Editor/drag-preview";
    import { createPage, openPage } from "../layout/navigation";
    import { currentTimeZone } from "../layout/preferences.svelte";
    import { visits } from "../Tab/activity.svelte";
    import { registerViewMenu } from "../Tab/view-menu";
    import type { ViewProps } from "../Tab/views";
    import Resizer from "../utils/Resizer.svelte";
    import { propertyName } from "./attribute-labels";
    import { confirmed } from "./confirmation.svelte";
    import { perform } from "./feedback.svelte";
    import { pageMenu } from "./page-menu";
    import { write } from "./page-sessions";
    import { registerList } from "./page-visits";

    let { tabId, params, onparams, source }: ViewProps<"calendar"> = $props();
    const daySeconds = 86400, empty: CalendarPage[] = [], uid = $props.id();
    let now = $state(nowSeconds()), chosen = $state<number>(), requested = $state<number>(), loaded = $state<number>();
    const zone = $derived(currentTimeZone());
    const today = $derived(Date.parse(secondsToDay(now, zone) + "T00:00:00Z") / 1000);
    const selected = $derived(chosen ?? today);
    const requestedMonth = $derived(requested ?? pickerPageStart("day", today));
    const month = $derived(loaded ?? requestedMonth);
    const gridRows = $derived(pickerRows("day", month));
    const days = $derived(gridRows.flat().filter(date => date !== null));
    const heading = $derived(secondsToMonth(month));
    const pageIndex = new SvelteMap<string, CalendarPage>();
    const byDay = new SvelteMap<number, CalendarPage[]>();
    const agenda = $derived(byDay.get(selected) ?? empty);
    const agendaIds = $derived(agenda.map(page => page.id));
    const sortLanguage = $derived(currentLanguage());
    let lastLanguage = "";
    let collator = new Intl.Collator("zh-CN-u-co-pinyin", { numeric: true });

    let definitions = $state.raw<Awaited<ReturnType<typeof window.api.attributes.definitions>>>([]);
    let pending = $state(true), error = $state<ErrorValue>(""), definitionsReady = $state(false);
    let definitionsDirty = true, activeRange = "";
    const dateDefinition = $derived(definitions.find(def => def.id === params.date.id && def.type === "day"));
    const startDefinition = $derived(definitions.find(def => def.id === params.start?.id && def.type === "minute"));
    const statusDefinition = $derived(definitions.find(def => def.id === params.status?.id && def.type === "status"));
    const statuses = $derived(statusDefinition?.metadata.options ?? []);
    const complete = $derived(new Set(statuses.filter(option => option.group === "complete").map(option => option.id)));
    const openOption = $derived(statuses.find(option => option.group === "incomplete")?.id);
    const doneOption = $derived(statuses.find(option => option.group === "complete")?.id);

    let width = $state(0), grid = $state<HTMLElement>(), list: VirtualList;
    const agendaWidth = $derived(Math.min(width * .65, Math.max(width * .2, params.agendaWidth ?? width / 3)));
    const capacity = $state<number[]>([1, 1, 1, 1, 1, 1]);

    function measureWeek(week: Element): () => void {
        const index = Number(week.getAttribute("data-week"));
        const measure = (): void => {
            const header = week.querySelector(".date-number")?.getBoundingClientRect().height ?? 0;
            const available = week.querySelector(".entries")?.getBoundingClientRect().height ?? 0;
            if (header && available) capacity[index] = Math.floor(available / header);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(week);
        measure();
        return () => observer.disconnect();
    }

    function samePage(a: CalendarPage, b: CalendarPage): boolean {
        return a.date === b.date && a.start === b.start && a.status === b.status
            && a.hasStatus === b.hasStatus && a.title === b.title && a.pinned === b.pinned;
    }

    function applyRows(rows: CalendarPage[], ids?: string[]): void {
        const affected = new SvelteSet<number>();
        const incoming = new SvelteMap(rows.map(page => [page.id, page]));
        for (const id of ids ?? pageIndex.keys()) {
            const previous = pageIndex.get(id);
            if (!previous) continue;
            const next = incoming.get(id);
            if (next && samePage(previous, next)) incoming.delete(id);
            else {
                affected.add(previous.date);
                pageIndex.delete(id);
            }
        }
        for (const page of incoming.values()) {
            affected.add(page.date);
            pageIndex.set(page.id, page);
        }
        const language = sortLanguage, resort = language !== lastLanguage;
        if (resort) {
            collator = new Intl.Collator(language === "zh-CN" ? "zh-CN-u-co-pinyin" : language, { numeric: true });
            lastLanguage = language;
            for (const date of byDay.keys()) affected.add(date);
        }
        const changed = new SvelteMap<number, CalendarPage[]>();
        for (const page of pageIndex.values()) {
            if (!affected.has(page.date)) continue;
            const list = changed.get(page.date);
            if (list) list.push(page);
            else changed.set(page.date, [page]);
        }
        for (const date of affected) {
            const list = changed.get(date);
            if (!list) byDay.delete(date);
            else {
                list.sort((a, b) => (a.start ?? -Infinity) < (b.start ?? -Infinity) ? -1 : (a.start ?? -Infinity) > (b.start ?? -Infinity) ? 1
                    : collator.compare(a.title, b.title) || a.id.localeCompare(b.id));
                byDay.set(date, list);
            }
        }
    }

    async function load(ids: string[], initial: boolean): Promise<void> {
        const at = requestedMonth, language = sortLanguage;
        if (initial) pending = true;
        try {
            if (definitionsDirty) {
                definitionsDirty = false;
                try {
                    definitions = await window.api.attributes.definitions();
                    definitionsReady = true;
                }
                catch (problem) {
                    definitionsDirty = true;
                    throw problem;
                }
            }
            if (at !== requestedMonth || language !== sortLanguage) return;
            const range = at === month ? days : pickerRows("day", at).flat().filter(date => date !== null);
            const query: CalendarQuery | undefined = dateDefinition && {
                date: dateDefinition.id, start: startDefinition?.id, status: statusDefinition?.id,
                from: range[0], to: range[range.length - 1] + daySeconds
            };
            const key = JSON.stringify(query);
            const full = initial || key !== activeRange;
            const changed = ids.filter(Boolean);
            const rows = query && (full || changed.length) ? await window.api.pages.calendarRows(full ? query : { ...query, ids: changed }) : [];
            if (at !== requestedMonth || language !== sortLanguage) return;
            if (full || changed.length) applyRows(rows, full ? undefined : changed);
            loaded = at;
            activeRange = key ?? "";
            error = "";
        }
        catch (problem) {
            error = failure(problem);
            throw problem;
        }
        finally {
            if (at === requestedMonth && language === sortLanguage) pending = false;
        }
    }

    function choices(type: AttributeType, id: string | undefined, select: (id: string) => void): MenuItem[] {
        return definitions.filter(def => def.type === type).map(def => ({
            label: propertyName(def), checked: def.id === id, onselect: () => select(def.id)
        }));
    }
    function header(): MenuItem[] {
        const dates = choices("day", params.date.id, id => onparams({ ...params, date: { kind: "attribute", type: "day", id } }));
        return [
            { label: t("calendar.chooseDate"), items: dates, disabled: !dates.length },
            { label: t("calendar.chooseStart"), items: [
                { label: t("property.none"), checked: !params.start, onselect: () => onparams({ ...params, start: undefined }) },
                ...choices("minute", params.start?.id, id => onparams({ ...params, start: { kind: "attribute", type: "minute", id } }))
            ] },
            { label: t("calendar.chooseStatus"), items: [
                { label: t("property.none"), checked: !params.status, onselect: () => onparams({ ...params, status: undefined }) },
                ...choices("status", params.status?.id, id => onparams({ ...params, status: { kind: "attribute", type: "status", id } }))
            ] }
        ];
    }
    onMount(() => {
        const offMenu = registerViewMenu(tabId, header);
        const offList = registerList(tabId, change => {
            definitionsDirty ||= !!change.definition;
            return [...(change.summaryPages ?? change.pages), ...(change.purged ?? []), ...(change.definition ? [""] : [])];
        }, load);
        const timer = setInterval(() => now = nowSeconds(), 60000);
        return () => {
            clearInterval(timer);
            offMenu();
            offList();
        };
    });
    $effect(() => {
        void requestedMonth; void params.date.id; void params.start?.id; void params.status?.id; void sortLanguage;
        untrack(() => visits.refresh(tabId));
    });

    function selectDay(date: number, follow = false): void {
        chosen = date;
        if (follow) requested = pickerPageStart("day", date);
    }
    function shift(direction: number): void {
        const base = pickerPageStart("day", selected) === requestedMonth ? selected : requestedMonth;
        selectDay(shiftPickerPage("day", base, direction), true);
    }
    function goToday(): void {
        now = nowSeconds();
        selectDay(today, true);
    }
    function gridKeys(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event) || event.ctrlKey || event.altKey || event.metaKey) return;
        switch (event.key) {
            case keys.left: selectDay(movePickerDay("day", selected, -1), true); break;
            case keys.right: selectDay(movePickerDay("day", selected, 1), true); break;
            case keys.up: selectDay(movePickerDay("day", selected, -7), true); break;
            case keys.down: selectDay(movePickerDay("day", selected, 7), true); break;
            case keys.previousPage: shift(-1); break;
            case keys.nextPage: shift(1); break;
            case keys.today: goToday(); break;
            default: return;
        }
        event.preventDefault();
    }
    function newPage(date: number): void {
        if (dateDefinition && !dateDefinition.readonly) createPage({ [dateDefinition.id]: date });
    }
    function clickCell(event: MouseEvent, create = false): void {
        const target = event.target as Element;
        const row = target.closest<HTMLElement>("[data-calendar-page]");
        if (row) {
            if (!create && row.dataset.calendarPage && !target.closest(".ui-check")) open(row.dataset.calendarPage);
            return;
        }
        if (target.closest("button")) return;
        const cell = target.closest<HTMLElement>("[data-day]");
        if (!cell?.dataset.day) return;
        const date = Number(cell.dataset.day);
        selectDay(date);
        grid?.focus({ preventScroll: true });
        if (create) newPage(date);
    }

    function editPage(id: string, update: (attributes: Record<string, AttributeValue>) => Record<string, AttributeValue> | undefined): void {
        void perform(() => write(async () => {
            const { page } = await window.api.pages.readObjects(id, [id]);
            if (!page || page.attributes.deleted) return;
            const attributes = update(page.attributes);
            if (attributes) await confirmed(token => window.api.pages.commitEdit({ pageId: id, batch: 0, blocks: [], attributes }, source, token));
        }));
    }
    function toggle(page: CalendarPage): void {
        const status = statusDefinition;
        if (!status || status.readonly) return;
        editPage(page.id, attributes => {
            const value = attributes[status.id];
            const option = typeof value === "string" && complete.has(value) ? openOption : doneOption;
            return option && Object.hasOwn(attributes, status.id) ? { [status.id]: option } : undefined;
        });
    }
    function done(page: CalendarPage): boolean {
        return page.status !== null && complete.has(page.status);
    }
    function toggleLabel(page: CalendarPage): string {
        return t(done(page) ? "calendar.reopen" : "calendar.complete");
    }
    function canToggle(page: CalendarPage): boolean {
        return !!(statusDefinition && !statusDefinition.readonly && (done(page) ? openOption : doneOption));
    }
    function open(id: string): void {
        openPage(id, { currentGroup: true });
    }
    let menu = $state(false), point = $state({ x: 0, y: 0 }), target = $state.raw<CalendarPage>();
    let fromList = false;
    const anchor = { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) };
    const menuItems = $derived.by(() => {
        if (!menu || !target) return [];
        const page = target;
        const items: MenuItem[] = pageMenu({ id: page.id, attributes: { pinned: page.pinned } }, source, [page.id], true)
            .map(item => ({ label: item.label, shortcut: item.shortcut, onselect: item.run }));
        if (page.hasStatus && canToggle(page)) items.unshift({ label: toggleLabel(page), onselect: () => toggle(page) });
        return items;
    });
    function context(id: string, x: number, y: number, agendaRow: boolean): void {
        const page = pageIndex.get(id);
        if (!page) return;
        fromList = agendaRow;
        target = page; point = { x, y }; menu = true;
    }

    type Drag = {
        page: CalendarPage; row: HTMLElement; capture: HTMLElement; pointer: number;
        x: number; y: number; latest: { x: number; y: number }; events: AbortController;
        dateId: string; startId?: string; frame?: number; preview?: ReturnType<typeof dragPreview>;
    };
    let drag: Drag | undefined, suppressClick = false;
    let draggedId = $state<string>(), dropDay = $state<number>();

    function canDrag(page: CalendarPage): boolean {
        return !!dateDefinition && !dateDefinition.readonly && (page.start === null || !startDefinition?.readonly);
    }
    function beginDrag(event: PointerEvent): void {
        suppressClick = false;
        if (event.button !== 0 || !event.isPrimary || drag) return;
        const hit = event.target as Element;
        const row = hit.closest<HTMLElement>("[data-calendar-page]");
        const page = row && pageIndex.get(row.dataset.calendarPage ?? "");
        if (!page || !row || !dateDefinition || !canDrag(page) || hit.closest(".ui-check")) return;
        const events = new AbortController(), options = { signal: events.signal };
        drag = {
            page, row, capture: event.currentTarget as HTMLElement, pointer: event.pointerId,
            x: event.clientX, y: event.clientY, latest: { x: event.clientX, y: event.clientY }, events,
            dateId: dateDefinition.id, startId: startDefinition?.id
        };
        window.addEventListener("pointermove", moveDrag, options);
        window.addEventListener("pointerup", endDrag, options);
        window.addEventListener("pointercancel", cancelDrag, options);
        window.addEventListener("blur", cancelDrag, options);
        window.addEventListener("keydown", cancelWithEscape, options);
    }
    function dayUnder(x: number, y: number): number | undefined {
        const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
        return cell?.dataset.day !== undefined && grid?.contains(cell) ? Number(cell.dataset.day) : undefined;
    }
    function moveDrag(event: PointerEvent): void {
        const state = drag;
        if (!state || event.pointerId !== state.pointer) return;
        state.latest = { x: event.clientX, y: event.clientY };
        if (!state.preview) {
            if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return;
            if (!state.row.isConnected) {
                cancelDrag();
                return;
            }
            const box = state.row.getBoundingClientRect();
            state.capture.setPointerCapture(state.pointer);
            state.capture.addEventListener("lostpointercapture", cancelDrag, { signal: state.events.signal });
            state.preview = dragPreview([state.row], state.row, { x: state.x - box.left, y: state.y - box.top });
            draggedId = state.page.id; suppressClick = true;
        }
        if (state.frame === undefined) state.frame = requestAnimationFrame(() => {
            state.frame = undefined;
            state.preview?.move(state.latest);
            dropDay = dayUnder(state.latest.x, state.latest.y);
        });
    }
    function cancelDrag(): void {
        const state = drag;
        if (!state) return;
        drag = undefined;
        state.events.abort();
        if (state.frame !== undefined) cancelAnimationFrame(state.frame);
        if (state.capture.hasPointerCapture(state.pointer)) state.capture.releasePointerCapture(state.pointer);
        state.preview?.close();
        draggedId = dropDay = undefined;
    }
    function cancelWithEscape(event: KeyboardEvent): void {
        if (event.key !== keys.cancel || isComposingKey(event)) return;
        event.preventDefault();
        cancelDrag();
    }
    function endDrag(event: PointerEvent): void {
        const state = drag;
        if (!state || state.pointer !== event.pointerId) return;
        const date = state.preview ? dayUnder(event.clientX, event.clientY) : undefined;
        cancelDrag();
        if (date === undefined || date === state.page.date || state.dateId !== dateDefinition?.id || state.startId !== startDefinition?.id) return;
        editPage(state.page.id, attributes => {
            if (state.dateId !== dateDefinition?.id || state.startId !== startDefinition?.id || !canDrag(state.page)
                || typeof attributes[state.dateId] !== "number" || attributes[state.dateId] === date) return;
            const updates: Record<string, AttributeValue> = { [state.dateId]: date };
            const time = state.startId && attributes[state.startId];
            if (state.startId && typeof time === "number") {
                const clock = secondsToMinute(time, zone).slice(-5);
                updates[state.startId] = timeToSeconds("minute", secondsToDay(date) + " " + clock, zone);
            }
            return updates;
        });
    }
    function cancelClick(event: MouseEvent): void {
        if (!suppressClick || !event.detail) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
    }
    onDestroy(cancelDrag);
</script>

<section class="calendar" aria-label={commandLabel("calendar")} aria-busy={pending} onpointerdown={beginDrag} onclickcapture={cancelClick}>
    <header class="toolbar">
        <IconButton icon="chevron-left" label={t("calendar.previousMonth")} shortcut={keys.previousPage} onclick={() => shift(-1)} />
        <IconButton icon="chevron-right" label={t("calendar.nextMonth")} shortcut={keys.nextPage} onclick={() => shift(1)} />
        <Button onclick={goToday}>{t("calendar.today")}</Button>
        <h2 id={uid + "-month"}>{heading}</h2>
        <Button class="calendar-create" variant="primary" icon="add" disabled={!dateDefinition || !!dateDefinition.readonly}
            onclick={() => newPage(selected)}>{commandLabel("newPage")}</Button>
    </header>
    {#if error}
        <div class="message" role="alert">{message(error)} <Button onclick={() => visits.refresh(tabId)}>{t("dialog.retry")}</Button></div>
    {:else if pending}
        <div class="message" role="status">{t("library.loading")}</div>
    {:else if definitionsReady && !dateDefinition}
        <div class="message" role="status">{t("calendar.missingDate")}</div>
    {/if}
    <div class="calendar-layout" bind:clientWidth={width} style:--agenda-width={agendaWidth + "px"}>
        <div class="month-grid" role="grid" tabindex="0" aria-labelledby={uid + "-month"} data-month={heading} bind:this={grid}
            aria-activedescendant={days.includes(selected) ? uid + "-" + selected : undefined}
            onkeydown={gridKeys} onclick={event => clickCell(event)} ondblclick={event => clickCell(event, true)}
            oncontextmenu={event => {
                const id = (event.target as Element).closest<HTMLElement>("[data-calendar-page]")?.dataset.calendarPage;
                if (!id) return;
                event.preventDefault();
                context(id, event.clientX, event.clientY, false);
            }}>
            <div class="week weekday-row" role="row">
                {#each weekdays as weekday (weekday)}
                    <div role="columnheader">{t(`datePicker.weekdays.${weekday}`)}</div>
                {/each}
            </div>
            {#each gridRows as row, index (index)}
                <div class="week" role="row" data-week={index} {@attach measureWeek}>
                    {#each row as date, column (column)}
                        {#if date === null}
                            <div class="day" role="gridcell" aria-disabled="true"></div>
                        {:else}
                            {@const text = secondsToDay(date)}
                            {@const pages = byDay.get(date) ?? empty}
                            {@const fits = capacity[index]}
                            {@const visible = pages.length > fits ? Math.max(0, fits - 1) : fits}
                            <div id={uid + "-" + date} class="day" class:outside={!text.startsWith(heading)} class:drop-target={date === dropDay}
                                data-day={date} role="gridcell" aria-label={text} aria-selected={date === selected}>
                                <div class="date-number"><time datetime={text} aria-current={date === today ? "date" : undefined}>{Number(text.slice(-2))}</time></div>
                                <div class="entries">
                                    {#each pages.slice(0, visible) as page (page.id)}
                                        {@render pageRow(page, false)}
                                    {/each}
                                    {#if pages.length > visible && fits > 0}
                                        <Button variant="text" class="calendar-more" onclick={() => {
                                            selectDay(date);
                                            grid?.focus({ preventScroll: true });
                                        }}>{t("calendar.remaining", { count: pages.length - visible })}</Button>
                                    {/if}
                                </div>
                            </div>
                        {/if}
                    {/each}
                </div>
            {/each}
        </div>
        <Resizer direction="vertical" label={t("calendar.agendaWidth")} origin={width - agendaWidth} min={width * .35} max={width * .8}
            changeCB={size => onparams({ ...params, agendaWidth: Math.max(1, Math.round(width - size)) })} />
        <section class="agenda" aria-label={secondsToDay(selected)}>
            <header class="agenda-header">
                <h2>{secondsToDay(selected)}</h2>
                <span>{agendaIds.length}</span>
            </header>
            <VirtualList bind:this={list} ids={agendaIds} label={secondsToDay(selected)} empty={t("calendar.noPages")} lines={1} {pending}
                onrange={() => {}} onopen={open} oncontext={(id, x, y) => context(id, x, y, true)}>
                {#snippet row(id)}
                    {@const page = pageIndex.get(id)}
                    {#if page}{@render pageRow(page, true)}{/if}
                {/snippet}
            </VirtualList>
        </section>
    </div>
</section>
<Menu bind:open={menu} {anchor} items={menuItems} first onrestore={() => {
    if (fromList) list?.focus();
    else grid?.focus({ preventScroll: true });
}} />

{#snippet pageRow(page: CalendarPage, inAgenda: boolean)}
    <div class="calendar-entry" class:completed={done(page)} class:drag-source={page.id === draggedId}
        data-calendar-page={page.id} data-draggable={canDrag(page) || undefined}>
        {#if page.hasStatus}
            <Checkbox label={toggleLabel(page)} hideLabel bind:checked={() => done(page), () => {}} disabled={!canToggle(page)}
                onclick={event => event.stopPropagation()} onchange={() => toggle(page)} />
        {/if}
        {#if inAgenda}
            <span class="page-title" data-list-label>{page.title || t("shell.untitled")}</span>
            {#if page.start !== null}<span class="page-time">{secondsToMinute(page.start, zone).slice(-5)}</span>{/if}
        {:else}
            <Button variant="text" class="calendar-page"><span class="page-title">{page.title || t("shell.untitled")}</span></Button>
        {/if}
    </div>
{/snippet}

<style>
    .calendar { display: flex; flex-direction: column; height: 100%; min-height: 0; container-type: inline-size; background: var(--ui-surface-window); color: var(--ui-text); user-select: none; }
    .toolbar, .agenda-header { display: flex; align-items: center; gap: var(--ui-space-3); padding: var(--ui-space-2) var(--ui-space-3); min-height: var(--ui-toolbar-height); border-bottom: var(--ui-stroke) solid var(--ui-divider); }
    .toolbar { overflow-x: auto; flex: none; }
    .toolbar :global(.ui-control) { flex: none; }
    .toolbar :global(.calendar-create) { margin-inline-start: auto; }
    h2 { margin: 0; font-size: var(--ui-font-body); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .message { padding: var(--ui-space-2) var(--ui-space-3); font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    .message[role="alert"] { color: var(--ui-text-danger); }
    .calendar-layout { display: flex; flex: 1; min-height: 0; }
    .month-grid { display: grid; flex: 1; min-width: 0; grid-template-rows: var(--ui-row-height) repeat(6, minmax(calc(2 * var(--ui-row-height) + var(--ui-stroke)), 1fr)); overflow: auto; }
    .month-grid:focus { outline: none; }
    .month-grid:focus-visible { outline: var(--ui-focus-width) solid var(--ui-focus); outline-offset: calc(-1 * var(--ui-focus-width)); }
    .week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); min-height: 0; }
    .weekday-row { align-items: center; text-align: center; color: var(--ui-text-secondary); font-size: var(--ui-font-small); background: var(--ui-surface-panel); }
    .day { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-block-end: var(--ui-stroke) solid var(--ui-divider); border-inline-end: var(--ui-stroke) solid var(--ui-divider); overflow: hidden; }
    .day[aria-selected="true"] { background: var(--ui-selected-inactive); }
    .month-grid:focus .day[aria-selected="true"] { background: var(--ui-selected); color: var(--ui-text-selected); }
    .month-grid .day.drop-target { background: var(--ui-selected); box-shadow: inset 0 0 0 var(--ui-focus-width) var(--ui-focus); }
    .date-number { display: flex; flex: none; align-items: center; height: var(--ui-row-height); padding-inline: var(--ui-space-2); font-size: var(--ui-font-small); }
    .outside .date-number { color: var(--ui-text-disabled); }
    time[aria-current="date"] { color: var(--ui-accent); font-weight: 700; }
    .entries { flex: 1; min-height: 0; }
    .calendar-entry { display: flex; align-items: center; gap: var(--ui-space-1); height: var(--ui-row-height); min-width: 0; padding-inline: var(--ui-space-1); }
    .calendar-entry[data-draggable] { touch-action: none; }
    .calendar .drag-source { opacity: .4; }
    .calendar-entry :global(.ui-check) { flex: none; height: var(--ui-row-height); }
    .calendar-entry :global(.calendar-page), .entries :global(.calendar-more) { height: var(--ui-row-height); min-width: 0; justify-content: flex-start; padding-inline: var(--ui-space-1); }
    .calendar-entry :global(.calendar-page) { flex: 1; }
    .entries :global(.calendar-more) { max-width: 100%; color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    .page-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .page-time { color: var(--ui-text-secondary); font-variant-numeric: tabular-nums; }
    .completed .page-title { color: var(--ui-text-secondary); text-decoration: line-through; }
    .agenda { display: flex; flex-direction: column; flex: 0 0 var(--agenda-width); min-width: 0; min-height: 0; }
    .agenda-header { justify-content: space-between; flex: none; color: var(--ui-text-secondary); }
    .agenda-header h2 { color: var(--ui-text); }
    @container (max-width: 740px) {
        .calendar-layout { flex-direction: column; overflow: auto; }
        .month-grid { flex: 1 0 calc(13 * var(--ui-row-height) + 6 * var(--ui-stroke)); }
        .calendar-layout > :global(.sash) { display: none; }
        .agenda { flex: 1 0 12em; }
    }
</style>