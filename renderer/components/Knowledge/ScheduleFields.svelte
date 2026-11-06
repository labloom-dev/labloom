<div class="schedule-fields">
    <label>状态<select value={value.status} onchange={event => update({ status: event.currentTarget.value as Schedule["status"] })}><option value="todo">待开始</option><option value="doing">进行中</option><option value="done">已完成</option></select></label>
    <label>优先级<select value={value.priority} onchange={event => update({ priority: event.currentTarget.value as Schedule["priority"] })}><option value="low">低</option><option value="normal">普通</option><option value="high">高</option></select></label>
    <label class="check"><input type="checkbox" checked={value.allDay} onchange={toggleAllDay} />全天</label>
    <label>时区<input value={value.timezone} placeholder="Asia/Shanghai" onblur={event => timezone(event.currentTarget.value)} /></label>
    <label>开始<input type={value.allDay ? "date" : "datetime-local"} value={zonedInput(value.start, value.timezone)} onchange={event => date("start", event.currentTarget.value)} /></label>
    <label>结束 / 截止<input type={value.allDay ? "date" : "datetime-local"} value={zonedInput(value.end, value.timezone)} onchange={event => date("end", event.currentTarget.value)} /></label>
    <label>提醒时间<input type="datetime-local" value={zonedInput(value.reminder, value.timezone)} onchange={event => date("reminder", event.currentTarget.value)} /></label>
    <p>提醒保存在工作区，打开应用后会显示到期提醒。</p>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
</div>


<style>
    .schedule-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
    label { display: flex; flex-direction: column; gap: 7px; font-size: 11px; color: var(--c-muted); }
    input, select { min-width: 0; width: 100%; padding: 8px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); font: inherit; }
    .check { flex-direction: row; align-items: center; }
    .check input { width: auto; }
    p { grid-column: 1 / -1; margin: 0; color: var(--c-muted); font-size: 11px; }
</style>


<script lang="ts">
    import type { Schedule } from "../../../shared/types/knowledge";
    import { fromZonedInput, zonedInput } from "../../../shared/utils/schedule";

    let { value, onchange }: { value: Schedule; onchange: (value: Schedule) => void } = $props();
    let error = $state("");
    function update(patch: Partial<Schedule>): void { error = ""; onchange({ ...value, ...patch }); }
    function timezone(zone: string): void {
        try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); update({ timezone: zone }); }
        catch { error = "请输入有效的时区，例如 Asia/Shanghai 或 UTC。"; }
    }
    function date(key: "start" | "end" | "reminder", input: string): void {
        try { update({ [key]: fromZonedInput(input, value.timezone) }); }
        catch (cause) { error = cause instanceof Error ? cause.message : "时间无效。"; }
    }
    function toggleAllDay(event: Event): void {
        const allDay = (event.currentTarget as HTMLInputElement).checked;
        const convert = (date: string): string => !date ? "" : allDay ? zonedInput(date, value.timezone).slice(0, 10) : fromZonedInput(`${date.slice(0, 10)}T09:00`, value.timezone);
        update({ allDay, start: convert(value.start), end: convert(value.end) });
    }
</script>