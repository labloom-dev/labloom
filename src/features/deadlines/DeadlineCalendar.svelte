<script lang="ts">
  import { CalendarDays, LoaderCircle } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import type { Calendar as CalendarApi } from '@event-calendar/core'
  import EmptyState from '../../components/EmptyState.svelte'
  import type { Deadline } from '../../types'

  type EventCalendarModule = typeof import('@event-calendar/core')

  interface Props {
    deadlines: Deadline[]
    onedit: (deadlineId: string) => void
  }

  let { deadlines, onedit }: Props = $props()
  let CalendarComponent = $state.raw<EventCalendarModule['Calendar'] | null>(null)
  let plugins = $state.raw<CalendarApi.Plugin[]>([])
  let loadError = $state('')

  function calendarEvents(items: Deadline[]): CalendarApi.EventInput[] {
    const events: CalendarApi.EventInput[] = []
    for (const deadline of items) {
      const start = deadline.deadlineAt.slice(0, 19)
      const startValue = new Date(`${start}Z`)
      if (Number.isNaN(startValue.getTime())) continue
      const end = new Date(startValue.getTime() + 60_000).toISOString().slice(0, 19)
      events.push({
        id: deadline.id,
        title: deadline.title,
        start,
        end,
        editable: false,
        backgroundColor: deadline.type === 'conference' ? 'var(--accent-strong)' : 'var(--success)',
        textColor: '#fff',
        classNames: [`deadline-${deadline.type}`],
        extendedProps: { timezoneLabel: deadline.timezoneLabel },
      })
    }
    return events
  }

  let options = $derived.by((): CalendarApi.Options => ({
    view: 'dayGridMonth',
    events: calendarEvents(deadlines),
    locale: 'zh-CN',
    firstDay: 1,
    height: '100%',
    dayMaxEvents: true,
    eventDurationEditable: false,
    eventStartEditable: false,
    headerToolbar: {
      start: 'prev,next today',
      center: 'title',
      end: 'dayGridMonth,listMonth',
    },
    buttonText: {
      today: '今天',
      dayGridMonth: '月历',
      listMonth: '日程',
    },
    noEventsContent: '本月没有截止日期',
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventClick: ({ event }) => onedit(String(event.id)),
    eventDidMount: ({ el, event }) => {
      const timezoneLabel = String(event.extendedProps.timezoneLabel ?? '')
      el.title = timezoneLabel ? `${String(event.title)} · ${timezoneLabel}` : String(event.title)
    },
  }))

  onMount(() => {
    let mounted = true
    void import('@event-calendar/core')
      .then((module) => {
        if (!mounted) return
        CalendarComponent = module.Calendar
        plugins = [module.DayGrid, module.List]
      })
      .catch((error) => {
        if (mounted) loadError = error instanceof Error ? error.message : String(error)
      })
    return () => {
      mounted = false
    }
  })
</script>

<section class="calendar-shell" aria-busy={!CalendarComponent && !loadError}>
  {#if loadError}
    <EmptyState icon={CalendarDays} title="日历加载失败" description={loadError} />
  {:else if CalendarComponent}
    <CalendarComponent {plugins} {options} />
  {:else}
    <div class="loading"><LoaderCircle class="spinning" /><span>加载日历…</span></div>
  {/if}
</section>

<style>
  .calendar-shell { min-height: 0; flex: 1; padding: 16px 18px 18px; overflow: hidden; background: var(--surface-raised); }
  .loading { height: 100%; display: grid; place-content: center; justify-items: center; gap: 9px; color: var(--text-subtle); font-size: 12px; }
  .loading :global(svg) { width: 21px; height: 21px; }
  .calendar-shell :global(.ec) {
    --ec-bg-color: var(--surface-raised);
    --ec-text-color: var(--text-primary);
    --ec-border-color: var(--border);
    --ec-button-bg-color: var(--surface-raised);
    --ec-button-border-color: var(--border-strong);
    --ec-button-text-color: var(--text-muted);
    --ec-button-active-bg-color: var(--surface-hover);
    --ec-button-active-border-color: var(--accent);
    --ec-button-active-text-color: var(--text-primary);
    --ec-today-bg-color: color-mix(in srgb, var(--accent) 8%, var(--surface-raised));
    --ec-popup-bg-color: var(--surface-raised);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 12px;
  }
  .calendar-shell :global(.ec-toolbar) { min-height: 34px; margin-bottom: 12px; }
  .calendar-shell :global(.ec-title) { font-size: 15px; font-weight: 650; letter-spacing: 0; }
  .calendar-shell :global(.ec-button) { min-height: 30px; padding: 3px 9px; font: 11px/1.4 var(--font-sans); }
  .calendar-shell :global(.ec-event) { cursor: pointer; font-size: 10px; }
  .calendar-shell :global(.ec-list .ec-event) { min-height: 38px; align-items: center; font-size: 12px; }
  .calendar-shell :global(.ec-event-title) { letter-spacing: 0; }
  :global(.spinning) { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 700px) {
    .calendar-shell { padding: 10px; overflow: auto; }
    .calendar-shell :global(.ec) { min-width: 620px; min-height: 560px; }
  }
</style>
