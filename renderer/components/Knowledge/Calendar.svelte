<section class="workspace-page">
    <header class="page-heading"><div><span class="eyebrow">A LITTLE PLAN, A LITTLE PROGRESS</span><h1>日程计划</h1><p>为重要的事情留出时间，让想法慢慢成为现实。</p></div><div class="actions"><button class="button" onclick={() => createPage("task")}><Icon name="plus" size={15} />新建任务</button><button class="button primary" onclick={() => createPage("event")}>新建日程</button></div></header>
    <div class="calendar-controls"><div class="actions"><button class="button" aria-label="上个月" onclick={() => move(-1)}>←</button><h2>{month.getFullYear()} 年 {month.getMonth() + 1} 月</h2><button class="button" aria-label="下个月" onclick={() => move(1)}>→</button><button class="text-button" onclick={() => { month = new Date(); selected = ""; }}>今天</button></div><label><input type="checkbox" bind:checked={showDone} />显示已完成</label><button class="text-button" onclick={load}>刷新</button></div>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    <div class="paper-card calendar"><div class="weekdays">{#each ["一", "二", "三", "四", "五", "六", "日"] as day}<span>{day}</span>{/each}</div><div class="month-grid">{#each days as day}<button class="day" class:outside={day.date.getMonth() !== month.getMonth()} class:today={day.key === today} class:selected={day.key === selected} onclick={() => { selected = selected === day.key ? "" : day.key; }}><span class="day-number">{day.date.getDate()}</span>{#each day.items.slice(0, 3) as item}<span class="event" class:task={item.kind === "task"} class:done={item.schedule?.status === "done"}>{item.title}</span>{/each}{#if day.items.length > 3}<span class="more">+ {day.items.length - 3} 项</span>{/if}</button>{/each}</div></div>
    <section class="plan-list"><header><h2>{selected ? `${selected} 的计划` : "全部计划"}</h2><select aria-label="计划状态" bind:value={status}><option value="">全部状态</option><option value="todo">待开始</option><option value="doing">进行中</option><option value="done">已完成</option></select></header>
        {#if loading}<div class="empty-state" role="status">正在整理计划…</div>{:else if !visible.length}<div class="empty-state"><Icon name="calendar" size={32} /><strong>给下一步探索留一点空白</strong><p>新建任务或日程，添加时间、优先级和提醒。</p></div>{:else}{#each visible as item (item.id)}<div class="plan-row paper-card"><input type="checkbox" aria-label={`完成：${item.title}`} checked={item.schedule?.status === "done"} onchange={event => complete(item, event.currentTarget.checked)} /><button class="plan-title" onclick={() => openPage(item)}><strong>{item.title}</strong><span>{item.schedule?.end ? formatTime(item.schedule) : "未设置截止时间"}</span></button><span class="badge">{item.kind === "task" ? "任务" : "日程"}</span><span class="badge" class:overdue={isOverdue(item.schedule)}>{isOverdue(item.schedule) ? "已逾期" : item.schedule?.status === "done" ? "已完成" : item.schedule?.priority === "high" ? "高优先级" : item.schedule?.status === "doing" ? "进行中" : "待开始"}</span></div>{/each}{/if}
    </section>
</section>


<style>
    .actions, .calendar-controls, .plan-list header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .calendar-controls { justify-content: space-between; margin-bottom: 18px; }
    h2 { margin: 0; font-size: 15px; }
    label { color: var(--c-muted); font-size: 11px; }
    .calendar { overflow: hidden; box-shadow: none; }
    .weekdays, .month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .weekdays { padding: 12px 0; background: var(--c-gold-light); text-align: center; font-size: 11px; font-weight: 800; }
    .day { min-height: 100px; padding: 8px; border-top: 1px solid var(--c-line); border-right: 1px solid var(--c-line); text-align: left; overflow: hidden; }
    .day:nth-child(7n) { border-right: 0; }
    .day:hover, .day.selected { background: var(--c-cream); }
    .day.selected { outline: 2px solid var(--c-accent); outline-offset: -2px; }
    .day.outside { opacity: .4; }
    .day-number { display: inline-grid; place-items: center; width: 23px; height: 23px; margin-bottom: 5px; border-radius: 50%; font-size: 11px; }
    .today .day-number { background: var(--c-ink); color: var(--c-paper); }
    .event { display: block; margin: 3px 0; padding: 4px 5px; border-radius: 4px; background: var(--c-lilac); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; font-size: 9px; }
    .event.task { background: var(--c-sage); }
    .event.done { text-decoration: line-through; opacity: .55; }
    .more { color: var(--c-muted); font-size: 9px; }
    .plan-list { margin-top: 28px; }
    .plan-list header { justify-content: space-between; margin-bottom: 15px; }
    select { padding: 7px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); font: inherit; font-size: 11px; }
    .plan-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 15px 18px; margin-bottom: 10px; box-shadow: none; }
    .plan-title { flex: 1; min-width: 100px; text-align: left; }
    .plan-title strong { display: block; font-size: 12px; }
    .plan-title span { display: block; margin-top: 6px; color: var(--c-muted); font-size: 10px; }
    .overdue { color: #9a4a38; background: #f8e6dc; }
    @container (max-width: 600px) { .day { min-height: 74px; padding: 4px; } .event { font-size: 8px; padding: 3px; } .calendar-controls .actions { gap: 8px; } }
</style>


<script lang="ts">
    import { untrack } from "svelte";
    import type { PageSummary, Schedule } from "../../../shared/types/knowledge";
    import { isOverdue, scheduleTime, zonedInput } from "../../../shared/utils/schedule";
    import { createPage, openPage } from "../layout/navigation";
    import Icon from "../utils/Icon.svelte";
    import { editPage, knowledgeState, loadPage, perform, savePage, sessions } from "./state.svelte";

    let items = $state<PageSummary[]>([]);
    let month = $state(new Date());
    let selected = $state("");
    let status = $state("");
    let showDone = $state(false);
    let loading = $state(true);
    let error = $state("");
    let generation = 0;
    const dateKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const today = dateKey(new Date());
    const dateFor = (value: string, schedule: Schedule): string => zonedInput(value, schedule.timezone).slice(0, 10);
    function onDay(item: PageSummary, key: string): boolean {
        const schedule = item.schedule!;
        const start = dateFor(schedule.start || schedule.end, schedule), end = dateFor(schedule.end || schedule.start, schedule);
        return item.kind === "task" ? end === key : key >= start && key <= end;
    }
    const filtered = $derived(items.filter(item => showDone || item.schedule?.status !== "done"));
    const days = $derived.by(() => {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        first.setDate(first.getDate() - (first.getDay() + 6) % 7);
        return Array.from({ length: 42 }, (_, offset) => { const date = new Date(first); date.setDate(date.getDate() + offset); const key = dateKey(date); return { date, key, items: filtered.filter(item => onDay(item, key)) }; });
    });
    const visible = $derived(filtered.filter(item => (!status || item.schedule?.status === status) && (!selected || onDay(item, selected))).sort((a, b) => (scheduleTime(a.schedule!.end, a.schedule!.timezone, true) || Infinity) - (scheduleTime(b.schedule!.end, b.schedule!.timezone, true) || Infinity)));
    $effect(() => { knowledgeState.version; untrack(() => { void load(); }); });
    function move(amount: number): void { month = new Date(month.getFullYear(), month.getMonth() + amount, 1); selected = ""; }
    function formatTime(schedule: Schedule): string { return `${zonedInput(schedule.end, schedule.timezone).replace("T", " ")}${schedule.allDay ? "（全天）" : ` ${schedule.timezone}`}`; }
    async function load(): Promise<void> {
        const request = ++generation; error = "";
        try {
            const results = await Promise.all((["task", "event"] as const).map(async kind => {
                const pages: PageSummary[] = []; let offset = 0;
                while (true) { const batch = await window.api.knowledge.list({ kind, offset, limit: 500 }); pages.push(...batch.items); offset += batch.items.length; if (offset >= batch.total || !batch.items.length) return pages; }
            }));
            if (request === generation) items = results.flat();
        }
        catch (cause) { if (request === generation) error = cause instanceof Error ? cause.message : "计划加载失败。"; }
        finally { if (request === generation) loading = false; }
    }
    async function complete(item: PageSummary, done: boolean): Promise<void> { await perform("正在更新计划", async () => { await loadPage(item.id, true); const page = sessions[item.id]?.page; if (!page?.schedule) throw new Error("计划不存在。"); editPage(item.id, { schedule: { ...page.schedule, status: done ? "done" : "todo" } }); if (!await savePage(item.id)) throw new Error(sessions[item.id].error); }); }
</script>