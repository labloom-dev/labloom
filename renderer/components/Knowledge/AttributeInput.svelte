<div class="attribute-input">
    {#if definition.type === "file" || definition.type === "files"}
        <FileInput {definition} {value} {session} disabled={disabled || !!definition.readonly} {onchange} />
    {:else if definition.readonly || disabled}
        {#if definition.type === "page-link" && typeof value === "string"}
            <button class="text-button" onclick={() => openPage(value as string)}>打开关联页面</button>
        {:else}
            <span class="readonly">{empty ? "未填写" : display(definition, value, { zone })}</span>
        {/if}
    {:else if definition.type === "recurrence"}
        {#if value === null}<button class="text-button" onclick={() => onchange({ every: 60, unit: "minute" })}>设置自动刷新</button>
        {:else}<label class="recurrence">每<input aria-label="刷新间隔（分钟）" type="number" min="15" max="1440" value={recurrenceMinutes(value) ?? 60} onchange={event => onchange({ every: event.currentTarget.valueAsNumber, unit: "minute" })} />分钟</label>{/if}
    {:else if definition.type === "boolean"}
        <select value={String(value)} onchange={event => onchange(event.currentTarget.value === "true")}>
            <option value="true">是</option>
            <option value="false">否</option>
        </select>
    {:else if definition.type === "select"}
        <select value={empty ? "" : String(value)} onchange={event => onchange(event.currentTarget.value || emptyValue(definition.type))}>
            <option value="">未填写</option>
            {#each definition.metadata.options ?? [] as option (option.id)}
                <option value={option.id}>{option.name}</option>
            {/each}
        </select>
    {:else if definition.type === "multiselect"}
        <div class="options">
            {#each definition.metadata.options ?? [] as option (option.id)}
                <label><input type="checkbox" checked={Array.isArray(value) && value.includes(option.id)} onchange={event => {
                    const current = Array.isArray(value) ? value : []; onchange(event.currentTarget.checked ? [...current, option.id] : current.filter(id => id !== option.id));
                }} />{option.name}</label>
            {:else}
                <span class="readonly">暂无选项，可在共享属性中添加</span>
            {/each}
        </div>
    {:else if definition.type === "page-link" || definition.type === "page-links"}
        <div class="links">
            {#each (Array.isArray(value) ? value : typeof value === "string" ? [value] : []) as id (id)}
                <span>
                    <button class="text-button" onclick={() => openPage(String(id))}>打开页面</button>
                    <button onclick={() => onchange(Array.isArray(value) ? value.filter(item => item !== id) : emptyValue(definition.type))}>移除</button>
                </span>
            {/each}
            <button class="text-button" onclick={() => picker = !picker}>选择页面</button>
        </div>
        {#if picker}
            <TargetPicker onclose={() => picker = false} onselect={target => {
                if (target.kind !== "page") {
                    error = { kind: "attribute-page-required" }; return;
                } onchange(definition.type === "page-link" ? target.id : [...new Set([...(Array.isArray(value) ? value : []), target.id])]); picker = false;
            }} />
        {/if}
    {:else if definition.type === "minute"}
        <input type="datetime-local" value={empty ? "" : secondsToWall(value as number, zone)} onchange={event => change(() => event.currentTarget.value ? wallToSeconds(event.currentTarget.value, zone) : emptyValue(definition.type))} />
        <small>{zone}</small>
    {:else if definition.type === "json"}
        <textarea value={empty ? "" : JSON.stringify(value, null, 2)} onchange={event => change(() => event.currentTarget.value ? JSON.parse(event.currentTarget.value) : emptyValue(definition.type))} placeholder="JSON 值"></textarea>
    {:else if definition.type === "number"}
        <input type="number" value={empty ? "" : value as number} onchange={event => onchange(event.currentTarget.value ? event.currentTarget.valueAsNumber : emptyValue(definition.type))} />
    {:else if definition.type === "hour"}
        <div class="hour-input">
            <input type="date" aria-label="日期" value={hourDay} onchange={event => {
                hourDay = event.currentTarget.value; changeHour();
            }} />
            <select aria-label="小时" value={hour} onchange={event => {
                hour = event.currentTarget.value; changeHour();
            }}>
                {#each Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")) as item (item)}
                    <option value={item}>{item}时</option>
                {/each}
            </select>
        </div>
        <small>{zone}</small>
    {:else if definition.type === "day"}
        <input type="date" value={empty ? "" : secondsToDay(value as number)} onchange={event => change(() => event.currentTarget.value ? dayToSeconds(event.currentTarget.value) : emptyValue(definition.type))} />
        {#if empty}<small>未填写</small>{/if}
    {:else if definition.type === "month"}
        <input type="month" value={empty ? "" : secondsToMonth(value as number)} onchange={event => change(() => event.currentTarget.value ? monthToSeconds(event.currentTarget.value) : emptyValue(definition.type))} />
        {#if empty}<small>未填写</small>{/if}
    {:else if definition.type === "year"}
        <input type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" aria-label="四位年份" placeholder="YYYY" value={empty ? "" : secondsToYear(value as number)} onchange={event => change(() => event.currentTarget.value ? yearToSeconds(event.currentTarget.value) : emptyValue(definition.type))} />
        {#if empty}<small>未填写</small>{/if}
    {:else}
        <textarea rows={definition.id === "paper_abstract" ? 4 : 1} value={String(value)} onchange={event => onchange(event.currentTarget.value)}></textarea>
    {/if}
    {#if error}
        <small class="error">{message(error)}</small>
    {/if}
</div>
<style>
    .attribute-input { position: relative; min-width: 0; flex: 1; font-size: var(--font-secondary); }
    input:not([type="checkbox"]), select, textarea { width: 100%; height: var(--button-height); padding: 2px 5px; border: 1px solid var(--c-line); border-radius: var(--control-radius); background: var(--c-paper); color: var(--c-ink); font: inherit; min-width: 0; user-select: text; }
    textarea { resize: vertical; min-height: var(--button-height); }
    .attribute-input:focus-within small, small.error { display: block; position: absolute; top: 100%; left: 0; z-index: 45; background: var(--c-paper); padding: 3px; font-size: var(--font-min); }
    .readonly { display: block; overflow: hidden; text-overflow: ellipsis; color: var(--c-muted); overflow-wrap: anywhere; white-space: nowrap; }
    .recurrence { display: flex; align-items: center; gap: 3px; }
    .hour-input { display: flex; gap: 8px; }
    .hour-input select { width: 78px; flex-shrink: 0; }
    .options, .links { display: flex; flex-wrap: wrap; gap: 8px 12px; }
    .options label, .links span { display: flex; gap: 6px; align-items: center; }
    small { display: none; margin-top: 0; color: var(--c-muted); }
    .error { color: var(--c-reader-error-text); }
</style>
<script lang="ts">
    import { failure, message, type ErrorValue } from "../../i18n.svelte";
    import { recurrenceMinutes } from "../../../shared/content/timers";
    import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import { dayToSeconds, monthToSeconds, secondsToDay, secondsToMonth, secondsToYear, wallToSeconds, secondsToWall, yearToSeconds } from "../../../shared/content/time";
    import { display } from "../../../shared/attrs/format";
    import { emptyValue, isEmpty } from "../../../shared/attrs/values";
    import { currentTimeZone } from "../layout/preferences.svelte";
    import { openPage } from "../layout/navigation";
    import FileInput from "./FileInput.svelte";
    import { type PageSession } from "./state.svelte";

    import TargetPicker from "./TargetPicker.svelte";
    let { definition, value, disabled = false, session, onchange }: { definition: AttributeDefinition; value: AttributeValue; disabled?: boolean; session?: PageSession; onchange: (value: AttributeValue) => void } = $props();
    const zone = $derived(currentTimeZone());
    const empty = $derived(isEmpty(definition.type, value));
    let picker = $state(false), error = $state<ErrorValue>("");
    let hourDay = $state(""), hour = $state("00");
    $effect(() => {
        const wall = definition.type === "hour" && !empty ? secondsToWall(value as number, zone) : "";
        hourDay = wall.slice(0, 10);
        hour = wall.slice(11, 13) || "00";
    });
    function changeHour(): void {
        change(() => hourDay ? wallToSeconds(`${hourDay}T${hour}:00`, zone) : emptyValue(definition.type));
    }
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