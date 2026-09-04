<script lang="ts">
  import Modal from './Modal.svelte'
  import { appState } from '../app/state.svelte'
  import { persistEntries, persistSettings } from '../app/persistence'
  import type { Theme } from '../types'

  interface Props {
    onclose: () => void
  }

  let { onclose }: Props = $props()
  let refreshIntervalMinutes = $state(appState.settings.refreshIntervalMinutes)
  let maxEntriesPerFeed = $state(appState.settings.maxEntriesPerFeed)
  let zoteroBaseUrl = $state(appState.settings.zoteroBaseUrl)
  let ccfFeedUrl = $state(appState.settings.ccfFeedUrl)
  let theme = $state<Theme>(appState.settings.theme)
  let loading = $state(false)
  let error = $state('')

  function validHttpUrl(value: string, optional = false): boolean {
    if (optional && !value.trim()) return true
    try {
      return ['http:', 'https:'].includes(new URL(value.trim()).protocol)
    } catch {
      return false
    }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    error = ''
    const interval = Math.round(Number(refreshIntervalMinutes))
    const maxEntries = Math.round(Number(maxEntriesPerFeed))
    if (!Number.isFinite(interval) || interval < 1 || interval > 1440) {
      error = '刷新间隔应为 1 到 1440 分钟'
      return
    }
    if (!Number.isFinite(maxEntries) || maxEntries < 10 || maxEntries > 1000) {
      error = '每个 Feed 保留数量应为 10 到 1000'
      return
    }
    if (!validHttpUrl(zoteroBaseUrl)) {
      error = 'Zotero API 地址必须是有效的 HTTP 或 HTTPS URL'
      return
    }
    if (!validHttpUrl(ccfFeedUrl, true)) {
      error = 'CCF RSS 地址必须是有效的 HTTP 或 HTTPS URL'
      return
    }

    const previous = appState.settings
    const previousEntries = appState.entries
    appState.settings = {
      refreshIntervalMinutes: interval,
      maxEntriesPerFeed: maxEntries,
      zoteroBaseUrl: zoteroBaseUrl.trim().replace(/\/+$/, ''),
      ccfFeedUrl: ccfFeedUrl.trim(),
      theme,
    }
    appState.entries = Object.fromEntries(
      Object.entries(appState.entries).map(([feedId, entries]) => [feedId, entries.slice(0, maxEntries)]),
    )
    loading = true
    try {
      await Promise.all([persistSettings(), persistEntries()])
      onclose()
    } catch (cause) {
      appState.settings = previous
      appState.entries = previousEntries
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }
</script>

<Modal title="设置" {onclose} width="560px">
  <form onsubmit={submit} aria-busy={loading}>
    <div class="two-columns">
      <label>
        <span>刷新间隔（分钟）</span>
        <input bind:value={refreshIntervalMinutes} type="number" min="1" max="1440" required />
      </label>
      <label>
        <span>每个 Feed 最多文章数</span>
        <input bind:value={maxEntriesPerFeed} type="number" min="10" max="1000" required />
      </label>
    </div>
    <label>
      <span>Zotero Local API</span>
      <input bind:value={zoteroBaseUrl} type="url" required placeholder="http://localhost:23119/api" />
    </label>
    <label>
      <span>CCF RSS URL</span>
      <input bind:value={ccfFeedUrl} type="url" placeholder="未配置" />
    </label>
    <label>
      <span>主题</span>
      <select bind:value={theme}>
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer>
      <button type="button" class="secondary" onclick={onclose} disabled={loading}>取消</button>
      <button type="submit" class="primary" disabled={loading}>{loading ? '保存中…' : '保存设置'}</button>
    </footer>
  </form>
</Modal>

<style>
  form { display: grid; gap: 15px; }
  label { min-width: 0; display: grid; gap: 6px; }
  label span { color: var(--text-muted); font-size: 12px; font-weight: 550; }
  input, select { width: 100%; min-width: 0; box-sizing: border-box; }
  .two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .error { margin: -2px 0 0; color: var(--danger); font-size: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 3px; }
</style>
