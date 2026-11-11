<section class="workspace-page calendar">
    <header class="page-heading">
        <div>
            <span class="eyebrow">MAKE ROOM FOR WHAT MATTERS</span>
            <h1>研究日历</h1>
            <p>给重要的想法，留出专注的时间。</p>
        </div>
        <div class="actions">
            <ListHistory {tabId} bind:history />
            <button class="button" onclick={() => createPage("event", { schedule_date: selected })}>新建日程</button>
            <button class="button primary" onclick={() => createPage("task", { schedule_date: selected })}>新建任务</button>
        </div>
    </header>
    {#if error}
        <div class="notice error">{error}</div>
    {/if}
    <div class="calendar-layout">
        <section class="paper-card month-card">
            <header>
                <button class="button" onclick={() => shift(-1)}>←</button>
                <h2>{month.getUTCFullYear()} 年 {month.getUTCMonth() + 1} 月</h2>
                <button class="button" onclick={() => shift(1)}>→</button>
                <button class="text-button" onclick={() => {
                    now = nowSeconds(); viewedMonth = undefined; selectedDay = undefined;
                }}>今天</button>
            </header>
            <div class="weekdays">
                {#each ["一", "二", "三", "四", "五", "六", "日"] as label (label)}
                    <span>{label}</span>
                {/each}
            </div>
            <div class="days">
                {#each days as day (day.key)}
                    <button class="day" class:selected={selected === day.key} class:outside={day.date.getUTCMonth() !== month.getUTCMonth()} class:today={day.key === today} onclick={() => selectedDay = day.key}>
                        <strong>{day.date.getUTCDate()}</strong>
                        {#each (byDay[day.key] ?? []).slice(0, 3) as page (page.id)}
                            <span class:done={page.attributes.task_status === "done"}>{page.title || "未命名"}</span>
                        {/each}
                        {#if (byDay[day.key]?.length ?? 0) > 3}
                            <small>更多…</small>
                        {/if}
                    </button>
                {/each}
            </div>
        </section>
        <section class="paper-card agenda">
            <h2>{selected}</h2>
            {#if pending}
                <p>正在读取日程…</p>
            {/if}
            {#each byDay[selected] ?? [] as page (page.id)}
                <div class="agenda-item">
                    <button class="page-link" onclick={() => openPage(page.id)}>
                        <small>{kindNames[page.kind]}</small>
                        <strong>{page.title || "未命名"}</strong>
                        <span>{timeLabel(page)}</span>
                    </button>
                    {#if page.kind === "task"}
                        <button class="text-button" onclick={() => toggle(page.id)}>{page.attributes.task_status === "done" ? "重新打开" : "完成任务"}</button>
                    {/if}
                </div>
            {:else}
                <div class="empty-state">
                    <Icon name="calendar" size={32} />
                    <p>这一天还没有安排</p>
                </div>
            {/each}
            <h3>未安排日期</h3>
            {#each (byDay[""] ?? []).slice(0, 20) as page (page.id)}
                <button class="unscheduled" onclick={() => openPage(page.id)}>{page.title || "未命名"}</button>
            {/each}
        </section>
    </div>
    <section class="paper-card notices">
        <h2>提醒</h2>
        <p>应用运行时会检查到期提醒；关闭期间错过的提醒会在下次运行时补发。</p>
        {#each notices as notice (notice.id)}
            <button class:unread={!notice.isRead} onclick={() => read(notice)}>
                <span>{notice.title}</span>
                <small>{displayMilliseconds(notice.createdAt)}</small>
                <span>{notice.isRead ? "已读" : "未读"}</span>
            </button>
        {:else}
            <p>还没有提醒记录。可在任务或日程的属性中设置提醒时间。</p>
        {/each}
    </section>
</section>
<style>
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .calendar-layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; }
    .month-card { padding: 18px; min-width: 0; }
    .month-card header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 18px; }
    h2 { font-size: 16px; margin: 0; }
    .weekdays, .days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .weekdays span { padding: 8px; text-align: center; color: var(--c-muted); font-size: 11px; }
    .day { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-height: 96px; min-width: 0; padding: 9px; border: 1px solid var(--c-line); text-align: left; }
    .day strong { font-size: 12px; }
    .day span { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; padding: 3px; border-radius: 4px; background: var(--c-sage); }
    .outside { opacity: .45; }
    .selected { background: var(--c-gold-light); outline: 2px solid var(--c-accent); outline-offset: -2px; }
    .today strong { color: var(--c-accent); text-decoration: underline; }
    .done { text-decoration: line-through; opacity: .6; }
    .agenda { padding: 22px; }
    .agenda-item { padding: 18px 0; border-bottom: 1px dashed var(--c-line); font-size: 12px; }
    .page-link { display: flex; flex-direction: column; gap: 8px; text-align: left; width: 100%; }
    .agenda-item small, .agenda-item span, .notices p { color: var(--c-muted); font-size: 11px; }
    .agenda-item > button:last-child { margin-top: 10px; }
    h3 { font-size: 13px; margin-top: 28px; }
    .unscheduled { display: block; margin-top: 12px; font-size: 12px; text-align: left; }
    .notices { margin-top: 22px; padding: 22px; }
    .notices > button { display: flex; gap: 20px; justify-content: space-between; width: 100%; padding: 14px 0; border-bottom: 1px dashed var(--c-line); font-size: 12px; text-align: left; }
    .unread { font-weight: 700; }
    @container (max-width: 900px) { .calendar-layout { grid-template-columns: 1fr; } .day { min-height: 75px; padding: 6px; } }
</style>
<script lang="ts">
    import { onMount } from "svelte";
    import { type PageSummary } from "../../../shared/types/content";
    import { type Notice, type HistoryState } from "../../../shared/types/knowledge";
    import ListHistory from "./ListHistory.svelte";
    import { nowSeconds, scheduleDay, secondsToWall } from "../../../shared/content/time";
    import { display } from "../../../shared/attrs/format";
    import { builtinAttrs } from "../../../shared/attrs/builtins";
    import { createPage, openPage } from "../layout/navigation";
    import { currentTimeZone, displayMilliseconds } from "../layout/preferences.svelte";
    import { message, confirmed, perform, registerList, writeFromTab } from "./state.svelte";
    import { kindNames } from "./labels";
    import Icon from "../utils/Icon.svelte";
    let { tabId }: { tabId: string } = $props();
    let history = $state.raw<HistoryState>({ canUndo: false, redo: [] });
    const zone = $derived(currentTimeZone());
    let now = $state(nowSeconds()), viewedMonth = $state<Date>(), selectedDay = $state<string>();
    const today = $derived(secondsToWall(now, zone).slice(0, 10));
    const month = $derived(viewedMonth ?? new Date(today + "T00:00:00Z")), selected = $derived(selectedDay ?? today);
    let scheduled = $state<PageSummary[]>([]), notices = $state<Notice[]>([]), pending = $state(false), error = $state("");
    const byDay = $derived(Object.groupBy(scheduled, page => scheduleDay(page.attributes, zone)));
    const days = $derived.by(() => {
        const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)), offset = (first.getUTCDay() + 6) % 7;
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), index - offset + 1));
            return { date, key: date.toISOString().slice(0, 10) };
        });
    });
    function shift(amount: number): void {
        viewedMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + amount, 1));
    }
    function timeLabel(page: PageSummary): string {
        return typeof page.attributes.schedule_start === "number" ? display({ id: "schedule_start", ...builtinAttrs.schedule_start }, page.attributes.schedule_start, { zone }).slice(11) : "全天";
    }
    let noticesDirty = false;
    onMount(() => {
        const timer = setInterval(() => now = nowSeconds(), 60000);
        return () => clearInterval(timer);
    });
    onMount(() => registerList(tabId, change => {
        noticesDirty ||= !!change.notices;
        return (change.summaryPages ?? change.pages).filter(id => !change.kinds || ["task", "event"].includes(change.kinds[id]));
    }, load));
    async function load(ids: string[], initial: boolean): Promise<void> {
        pending = initial;
        try {
            const changed = new Set(ids);
            const result = initial ? [] : scheduled.filter(row => !changed.has(row.id));
            for (const kind of ["task", "event"] as const) {
                for (let offset = 0; ; offset += 200) {
                    const batch = await window.api.knowledge.list({ kind, ids: initial ? undefined : ids, offset, limit: 200 });
                    result.push(...batch.items);
                    if (offset + batch.items.length >= batch.total) break;
                }
            }
            if (initial || noticesDirty) {
                noticesDirty = false;
                try {
                    notices = await window.api.knowledge.notices();
                }
                catch (problem) {
                    noticesDirty = true;
                    throw problem;
                }
            }
            history = await window.api.knowledge.history(tabId);
            scheduled = result.sort((a, b) => Number(a.kind === "event") - Number(b.kind === "event")
                || Number(b.attributes.modified_at) - Number(a.attributes.modified_at) || a.id.localeCompare(b.id));
            error = "";
        }
        catch (problem) {
            error = message(problem);
            throw problem;
        }
        finally {
            pending = false;
        }
    }
    function toggle(id: string): void {
        void perform(async () => {
            await writeFromTab(tabId, async () => {
                const { page } = await window.api.knowledge.readObjects(id, [id]);
                if (!page) throw new Error("找不到这项任务。");
                await confirmed(token => window.api.knowledge.commitEdit({ pageId: id, tabId, batch: 0, blocks: [], attributes: { task_status: page.attributes.task_status === "done" ? "todo" : "done" } }, token));
            });
        });
    }
    function read(notice: Notice): void {
        void perform(async () => {
            await writeFromTab(tabId, async () => {
                await window.api.knowledge.readNotice(notice.id, tabId);
                openPage(notice.pageId);
            });
        });
    }
</script>