<script lang="ts">
  import { CalendarClock, ExternalLink, LoaderCircle, Pencil, Trash2 } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import EmptyState from '../../components/EmptyState.svelte'
  import IconButton from '../../components/IconButton.svelte'
  import { formatOffsetDateTime, remainingDays } from '../../lib/date'
  import type { Deadline } from '../../types'
  import { sortDeadlines } from './deadline'

  interface Props {
    deadlines: Deadline[]
    openingId?: string | null
    onedit: (deadline: Deadline) => void
    ondelete: (deadline: Deadline) => void
    onopen: (deadline: Deadline) => void
  }

  let { deadlines, openingId = null, onedit, ondelete, onopen }: Props = $props()
  let sorted = $derived(sortDeadlines(deadlines))
  let now = $state(Date.now())

  onMount(() => {
    const timer = window.setInterval(() => (now = Date.now()), 60_000)
    return () => window.clearInterval(timer)
  })

  const typeLabels: Record<Deadline['type'], string> = {
    conference: '会议',
    journal: '期刊',
  }
  const sourceLabels: Record<Deadline['source'], string> = {
    manual: '手动',
    csv: 'CSV',
    ccf: 'CCF',
  }
</script>

<section class="list-panel" aria-label="截止日期列表">
  {#if sorted.length === 0}
    <EmptyState icon={CalendarClock} title="还没有截止日期" description="添加记录，或从 CSV 和 CCF RSS 导入。" />
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>截止时间</th>
            <th>状态</th>
            <th>来源</th>
            <th><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          {#each sorted as deadline (deadline.id)}
            <tr class:expired={Date.parse(deadline.deadlineAt) < now}>
              <td class="name-cell">
                <strong>{deadline.title}</strong>
                {#if deadline.note}<small title={deadline.note}>{deadline.note}</small>{/if}
              </td>
              <td><span class:journal={deadline.type === 'journal'} class="type">{typeLabels[deadline.type]}</span></td>
              <td class="date-cell">
                <time datetime={deadline.deadlineAt}>{formatOffsetDateTime(deadline.deadlineAt)}</time>
                <small>{deadline.timezoneLabel}</small>
              </td>
              <td><span class="remaining">{remainingDays(deadline.deadlineAt, now)}</span></td>
              <td><span class="source">{sourceLabels[deadline.source]}</span></td>
              <td class="actions">
                {#if deadline.url}
                  <IconButton label="打开官方链接" onclick={() => onopen(deadline)} disabled={openingId === deadline.id}>
                    {#if openingId === deadline.id}<LoaderCircle class="spinning" />{:else}<ExternalLink />{/if}
                  </IconButton>
                {/if}
                <IconButton label="编辑" onclick={() => onedit(deadline)}><Pencil /></IconButton>
                <IconButton label="删除" onclick={() => ondelete(deadline)}><Trash2 /></IconButton>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .list-panel { min-height: 0; flex: 1; overflow: hidden; background: var(--surface-raised); }
  .table-scroll { width: 100%; height: 100%; overflow: auto; }
  table { width: 100%; min-width: 790px; border-collapse: collapse; table-layout: fixed; text-align: left; }
  th { position: sticky; top: 0; z-index: 2; height: 34px; padding: 0 12px; color: var(--text-subtle); background: var(--surface-muted); border-bottom: 1px solid var(--border-strong); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  th:first-child { width: 30%; padding-left: 20px; }
  th:nth-child(2) { width: 8%; }
  th:nth-child(3) { width: 23%; }
  th:nth-child(4) { width: 13%; }
  th:nth-child(5) { width: 8%; }
  th:last-child { width: 106px; }
  td { height: 58px; padding: 7px 12px; color: var(--text-muted); border-bottom: 1px solid var(--border); font-size: 12px; vertical-align: middle; }
  td:first-child { padding-left: 20px; }
  tbody tr:hover { background: var(--surface-hover); }
  .name-cell, .date-cell { min-width: 0; }
  .name-cell strong, .name-cell small, .date-cell time, .date-cell small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name-cell strong { color: var(--text-primary); font-size: 13px; font-weight: 620; }
  .name-cell small, .date-cell small { margin-top: 3px; color: var(--text-subtle); font-size: 10px; }
  .date-cell time { color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .type, .source { display: inline-flex; align-items: center; height: 21px; padding: 0 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 10px; white-space: nowrap; }
  .type { color: var(--accent); background: var(--accent-soft); }
  .type.journal { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }
  .source { color: var(--text-subtle); background: var(--surface-muted); }
  .remaining { color: var(--text-primary); font-size: 11px; white-space: nowrap; }
  tr.expired .remaining { color: var(--danger); }
  tr.expired .name-cell strong { color: var(--text-muted); }
  .actions { display: flex; align-items: center; justify-content: flex-end; gap: 1px; }
  .actions :global(button) { width: 28px; height: 28px; flex-basis: 28px; }
  :global(.spinning) { animation: spin .8s linear infinite; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
