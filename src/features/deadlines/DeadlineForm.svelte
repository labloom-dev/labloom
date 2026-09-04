<script lang="ts">
  import { onMount } from 'svelte'
  import Modal from '../../components/Modal.svelte'
  import type { Deadline } from '../../types'
  import {
    buildDeadlineAt,
    localDateTimeFromDeadlineAt,
    normalizeDeadlineDraft,
    offsetFromDeadlineAt,
    type DeadlineDraft,
  } from './deadline'

  interface Props {
    onclose: () => void
    onsubmit: (value: DeadlineDraft) => Promise<void>
    deadline?: Deadline
  }

  let { onclose, onsubmit, deadline }: Props = $props()
  let title = $state('')
  let type = $state<Deadline['type']>('conference')
  let localDateTime = $state('')
  let timezoneLabel = $state('AoE')
  let utcOffset = $state('-12:00')
  let url = $state('')
  let note = $state('')
  let loading = $state(false)
  let error = $state('')
  let aoe = $derived(timezoneLabel.trim().toLowerCase() === 'aoe')

  function defaultLocalDateTime(): string {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}T23:59`
  }

  onMount(() => {
    title = deadline?.title ?? ''
    type = deadline?.type ?? 'conference'
    localDateTime = deadline ? localDateTimeFromDeadlineAt(deadline.deadlineAt) : defaultLocalDateTime()
    timezoneLabel = deadline?.timezoneLabel ?? 'AoE'
    utcOffset = deadline ? offsetFromDeadlineAt(deadline.deadlineAt) : '-12:00'
    url = deadline?.url ?? ''
    note = deadline?.note ?? ''
  })

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    error = ''
    try {
      const deadlineAt = buildDeadlineAt(localDateTime, utcOffset, timezoneLabel)
      const value = normalizeDeadlineDraft({ title, type, deadlineAt, timezoneLabel, url, note })
      loading = true
      await onsubmit(value)
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }
</script>

<Modal title={deadline ? '编辑截止日期' : '添加截止日期'} {onclose} width="560px">
  <form onsubmit={submit} aria-busy={loading}>
    <label>
      <span>标题</span>
      <input bind:value={title} required maxlength="160" placeholder="会议或期刊名称" />
    </label>

    <div class="two-columns compact">
      <label>
        <span>类型</span>
        <select bind:value={type} required>
          <option value="conference">会议</option>
          <option value="journal">期刊</option>
        </select>
      </label>
      <label>
        <span>截止时间</span>
        <input bind:value={localDateTime} type="datetime-local" step="60" required />
      </label>
    </div>

    <div class="two-columns">
      <label>
        <span>时区标签</span>
        <input bind:value={timezoneLabel} required maxlength="40" placeholder="AoE" />
      </label>
      <label>
        <span>UTC 偏移</span>
        <input
          value={aoe ? '-12:00' : utcOffset}
          oninput={(event) => (utcOffset = event.currentTarget.value)}
          disabled={aoe}
          required
          pattern="[+-](0[0-9]|1[0-4]):[0-5][0-9]"
          placeholder="+08:00"
        />
      </label>
    </div>

    <label>
      <span>官方链接</span>
      <input bind:value={url} type="url" placeholder="https://example.org/call-for-papers" />
    </label>
    <label>
      <span>备注</span>
      <textarea bind:value={note} rows="4" maxlength="2000" placeholder="轮次、方向或提交要求"></textarea>
    </label>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer>
      <button type="button" class="secondary" onclick={onclose} disabled={loading}>取消</button>
      <button type="submit" class="primary" disabled={loading}>{loading ? '保存中…' : '保存'}</button>
    </footer>
  </form>
</Modal>

<style>
  form { display: grid; gap: 15px; }
  label { min-width: 0; display: grid; gap: 6px; }
  label span { color: var(--text-muted); font-size: 12px; font-weight: 550; }
  input, select, textarea { width: 100%; min-width: 0; box-sizing: border-box; }
  textarea { resize: vertical; line-height: 1.5; }
  .two-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  .compact { grid-template-columns: minmax(130px, .65fr) minmax(0, 1.35fr); }
  .error { margin: -2px 0 0; color: var(--danger); font-size: 12px; line-height: 1.45; }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 3px; }
  @media (max-width: 560px) {
    .two-columns, .compact { grid-template-columns: 1fr; }
  }
</style>
