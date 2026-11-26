<script lang="ts">
    import type { TimePrecision } from "../../../shared/content/time";
    import { relativeDates, type QueryDate, type RelativeDate } from "../../../shared/workspace/query";
    import { t } from "../../i18n.svelte";
    import DatePicker from "../base/DatePicker.svelte";
    import Input from "../base/Input.svelte";
    import Select from "../base/Select.svelte";

    let { value, precision, zone, label, onchange }: { value: QueryDate | null; precision: TimePrecision; zone: string;
        label: string; onchange: (value: QueryDate | null) => void } = $props();
    const relative = $derived(value?.kind === "relative" ? value : undefined);
    const mode = $derived(relative ? "relative" : "absolute");
    const modes = $derived([{ value: "absolute", label: t("table.absolute") }, { value: "relative", label: t("table.relativeMode") }]);
    const periods = $derived(relativeDates.map(value => ({
        value, label: value === "past-days" || value === "next-days" ? t(`table.relativeOptions.${value}`) : t(`table.relative.${value}`)
    })));
    function choose(period: string): void {
        if (period === "past-days" || period === "next-days") onchange({ kind: "relative", period, days: relative && "days" in relative ? relative.days : 7 });
        else onchange({ kind: "relative", period } as RelativeDate);
    }
</script>

<div class="date-operand">
    <Select label={t("table.dateMode")} options={modes} value={mode} onchange={mode => onchange(mode === "absolute" ? null : { kind: "relative", period: "today" })} />
    {#if relative}
        <Select {label} options={periods} value={relative.period} onchange={choose} />
        {#if "days" in relative}
            <Input type="number" label={t("table.days")} value={String(relative.days)} inputProps={{ min: 1, step: 1 }}
                oninput={value => {
                    const days = Number(value);
                    if (relative && "days" in relative && Number.isSafeInteger(days) && days > 0) onchange({ ...relative, days });
                }} />
        {/if}
    {:else}
        <DatePicker {label} {precision} {zone} value={value?.kind === "absolute" ? value.seconds : null}
            onchange={seconds => onchange(seconds === null ? null : { kind: "absolute", seconds, precision })} />
    {/if}
</div>

<style>
    .date-operand { display: flex; align-items: stretch; flex-wrap: wrap; gap: var(--ui-space-1); min-width: 0; }
    .date-operand :global(.ui-select), .date-operand :global(.date-picker-trigger) { flex: 1; }
    .date-operand :global(.ui-field) { width: calc(3 * var(--ui-icon-normal)); }
</style>