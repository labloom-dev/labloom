<section class="workspace-page calendar">
    <header class="page-heading">
        <div>

            <h1>研究日历</h1>
            <p>给重要的想法，留出专注的时间。</p>
        </div>
        <div class="actions">
            <ListHistory {tabId} />
            <button class="button" disabled={!hasDate} onclick={() => createPage({ schedule_date: dayToSeconds(selected) })}>新建日程</button>
            <button class="button primary" disabled={!hasDate} onclick={createTask}>新建任务</button>
        </div>
    </header>
    {#if error}
        <div class="notice error">{message(error)}</div>
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
                            <ContextActions items={calendarMenu(page)}><span class:done={isComplete(page.attributes.task_status)}>{page.title || "未命名"}</span></ContextActions>
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
                <ContextActions items={calendarMenu(page)}><div class="agenda-item">
                    <button class="page-link" onclick={() => openPage(page.id)}>
                        <small>{Object.hasOwn(page.attributes, "task_status") ? "任务" : "日程"}</small>
                        <strong>{page.title || "未命名"}</strong>
                        <span>{timeLabel(page)}</span>
                    </button>
                    {#if canToggle(page)}
                        <button class="text-button" onclick={() => toggle(page.id)}>{isComplete(page.attributes.task_status) ? "重新打开" : "完成任务"}</button>
                    {/if}
                </div></ContextActions>
            {:else}
                <div class="empty-state">
                    <Icon name="calendar" size={32} />
                    <p>这一天还没有安排</p>
                </div>
            {/each}
        </section>
    </div>
    <section class="paper-card notices">
        <h2>提醒</h2>
        <p>在任意时间属性上点铃铛设置提醒。应用关闭期间到期的提醒会在下次运行时补发。</p>
        {#each notices as notice (`${notice.pageId}:${notice.attrId}:${notice.leadSeconds}`)}
            <button class:unread={!notice.seen} onclick={() => read(notice)}>
                <span>{notice.title} · {notice.attrName}</span>
                <small>{displayMilliseconds(notice.firedAt * 1000)}</small>
                <span>{notice.seen ? "已读" : "未读"}</span>
            </button>
        {:else}
            <p>还没有提醒记录。在任意时间属性上点铃铛设置提醒。</p>
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
    .day span { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-min); padding: 3px; border-radius: 4px; background: var(--c-sage); }
    .outside { opacity: .45; }
    .selected { background: var(--c-gold-light); outline: 2px solid var(--c-accent); outline-offset: -2px; }
    .today strong { color: var(--c-accent); text-decoration: underline; }
    .done { text-decoration: line-through; opacity: .6; }
    .agenda { padding: 22px; }
    .agenda-item { padding: 18px 0; border-bottom: 1px dashed var(--c-line); font-size: 12px; }
    .page-link { display: flex; flex-direction: column; gap: 8px; text-align: left; width: 100%; }
    .agenda-item small, .agenda-item span, .notices p { color: var(--c-muted); font-size: 11px; }
    .agenda-item > button:last-child { margin-top: 10px; }
    .notices { margin-top: 22px; padding: 22px; }
    .notices > button { display: flex; gap: 20px; justify-content: space-between; width: 100%; padding: 14px 0; border-bottom: 1px dashed var(--c-line); font-size: 12px; text-align: left; }
    .unread { font-weight: 700; }
    @container (max-width: 900px) { .calendar-layout { grid-template-columns: 1fr; } .day { min-height: 75px; padding: 6px; } }
</style>
<script lang="ts">
    import { failure, message, type ErrorValue } from "../../i18n.svelte";
    import { LabloomError } from "../../../shared/failure";
    import ContextActions from "../utils/ContextActions.svelte";
    import { pageMenu } from "./page-menu";
    import { onMount } from "svelte";
    import { type PageSummary } from "../../../shared/types/content";
    import { type Notice } from "../../../shared/types/knowledge";
    import ListHistory from "./ListHistory.svelte";
    import { scheduleDay } from "./calendar-day";
    import { dayToSeconds, nowSeconds, secondsToWall } from "../../../shared/content/time";
    import type { AttributeDefinition, AttributeValue } from "../../../shared/types/attributes";
    import { createPage, openPage } from "../layout/navigation";
    import { currentTimeZone, displayMilliseconds } from "../layout/preferences.svelte";
    import { confirmed, perform, registerList, writeFromTab } from "./state.svelte";
    import Icon from "../utils/Icon.svelte";
    let { tabId }: { tabId: string } = $props();
    const zone = $derived(currentTimeZone());
    let now = $state(nowSeconds()), viewedMonth = $state<Date>(), selectedDay = $state<string>();
    const today = $derived(secondsToWall(now, zone).slice(0, 10));
    const month = $derived(viewedMonth ?? new Date(today + "T00:00:00Z")), selected = $derived(selectedDay ?? today);
    let scheduled = $state<PageSummary[]>([]), notices = $state<Notice[]>([]), pending = $state(false), error = $state<ErrorValue>("");
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
        return typeof page.attributes.schedule_start === "number" ? secondsToWall(page.attributes.schedule_start, zone).slice(11) : "全天";
    }
    let definitions = $state.raw<AttributeDefinition[]>([]);
    const hasDate = $derived(definitions.some(def => def.id === "schedule_date" && def.type === "day"));
    const status = $derived(definitions.find(def => def.id === "task_status" && def.type === "status"));
    const priority = $derived(definitions.find(def => def.id === "priority" && def.type === "select"));
    const openOption = $derived(status?.metadata.options?.find(o => o.id === "todo" && o.group === "incomplete")
        ?? status?.metadata.options?.find(o => o.group === "incomplete"));
    const doneOption = $derived(status?.metadata.options?.find(o => o.id === "done" && o.group === "complete")
        ?? status?.metadata.options?.find(o => o.group === "complete"));
    function isComplete(value: AttributeValue): boolean {
        return !!status?.metadata.options?.some(o => o.id === value && o.group === "complete");
    }
    function canToggle(page: PageSummary): boolean {
        return Object.hasOwn(page.attributes, "task_status") && !!(isComplete(page.attributes.task_status) ? openOption : doneOption);
    }
    function createTask(): void {
        const initial: Record<string, AttributeValue> = { schedule_date: dayToSeconds(selected) };
        if (status) initial.task_status = openOption?.id ?? null;
        if (priority) initial.priority = priority.metadata.options?.some(o => o.id === "normal") ? "normal" : null;
        createPage(initial);
    }
    onMount(() => {
        const timer = setInterval(() => now = nowSeconds(), 60000);
        return () => clearInterval(timer);
    });
    onMount(() => registerList(tabId, change => {
        return [...(change.summaryPages ?? change.pages), ...(change.definition ? [change.definition] : []), ...(change.notices ? ["notices"] : [])];
    }, load));
    async function load(ids: string[], initial: boolean): Promise<void> {
        pending = initial;
        try {
            if (initial || ids.some(id => ["schedule_date", "task_status", "priority"].includes(id))) definitions = await window.api.attributes.definitions();
            const result: PageSummary[] = [];
            for (let offset = 0; hasDate; offset += 200) {
                const batch = await window.api.pages.list({ hasValue: "schedule_date", offset, limit: 200 });
                result.push(...batch.items);
                if (offset + batch.items.length >= batch.total) break;
            }
            notices = await window.api.timers.notices();
            scheduled = result.sort((a, b) => Number(Object.hasOwn(b.attributes, "task_status")) - Number(Object.hasOwn(a.attributes, "task_status"))
                || Number(b.attributes.modified_at) - Number(a.attributes.modified_at) || a.id.localeCompare(b.id));
            error = "";
        }
        catch (problem) {
            error = failure(problem);
            throw problem;
        }
        finally {
            pending = false;
        }
    }
    function calendarMenu(page: PageSummary): { label: string; run: () => void }[] {
        const items = pageMenu(page, tabId).filter(item => !["取消固定", "固定到侧栏"].includes(item.label)).map(item => ({ label: item.label, run: item.run }));
        if (canToggle(page)) items.push({ label: isComplete(page.attributes.task_status) ? "取消完成" : "完成任务", run: () => toggle(page.id) });
        return items;
    }
    function toggle(id: string): void {
        void perform(async () => {
            await writeFromTab(tabId, async () => {
                const { page } = await window.api.pages.readObjects(id, [id]);
                if (!page) throw new LabloomError({ kind: "page-missing" });
                const option = isComplete(page.attributes.task_status) ? openOption : doneOption;
                if (!Object.hasOwn(page.attributes, "task_status") || !option) return;
                await confirmed(token => window.api.pages.commitEdit({ pageId: id, tabId, batch: 0, blocks: [], attributes: { task_status: option.id } }, { kind: "workspace" }, token));
            });
        });
    }
    function read(notice: Notice): void {
        void perform(async () => {
            await writeFromTab(tabId, async () => {
                await window.api.timers.readNotice(notice.pageId, notice.attrId, notice.leadSeconds, tabId);
                openPage(notice.pageId);
            });
        });
    }
</script>