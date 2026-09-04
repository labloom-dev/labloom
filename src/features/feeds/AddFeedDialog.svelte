<script lang="ts">
  import Modal from '../../components/Modal.svelte'
  import type { FeedSource } from '../../types'
  import { onMount } from 'svelte'

  interface FormValue {
    title: string
    feedUrl: string
    folder?: string
  }

  interface Props {
    onclose: () => void
    onsubmit: (value: FormValue) => Promise<void>
    feed?: FeedSource
  }

  let { onclose, onsubmit, feed }: Props = $props()
  let title = $state('')
  let feedUrl = $state('')
  let folder = $state('')
  let loading = $state(false)
  let error = $state('')

  onMount(() => {
    title = feed?.title ?? ''
    feedUrl = feed?.feedUrl ?? ''
    folder = feed?.folder ?? ''
  })

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    error = ''
    const url = feedUrl.trim()
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 地址')
      loading = true
      await onsubmit({ title: title.trim(), feedUrl: url, folder: folder.trim() || undefined })
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }
</script>

<Modal title={feed ? '编辑订阅' : '添加 RSS 订阅'} {onclose}>
  <form onsubmit={submit}>
    <label>
      <span>Feed URL</span>
      <input bind:value={feedUrl} type="url" required disabled={Boolean(feed)} placeholder="https://example.org/feed.xml" />
    </label>
    <label>
      <span>显示名称</span>
      <input bind:value={title} placeholder="留空则使用 Feed 标题" />
    </label>
    <label>
      <span>文件夹</span>
      <input bind:value={folder} placeholder="例如：机器学习" />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer>
      <button type="button" class="secondary" onclick={onclose}>取消</button>
      <button type="submit" class="primary" disabled={loading}>{loading ? '保存中…' : '保存'}</button>
    </footer>
  </form>
</Modal>

<style>
  form { display: grid; gap: 15px; }
  label { display: grid; gap: 6px; }
  label span { color: var(--text-muted); font-size: 12px; font-weight: 550; }
  input { width: 100%; }
  .error { margin: -3px 0 0; color: var(--danger); font-size: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
