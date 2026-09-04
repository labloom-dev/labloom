<script lang="ts">
  import { ExternalLink, FileText, Mail, MailOpen, Star } from '@lucide/svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { appState, showToast } from '../../app/state.svelte'
  import EmptyState from '../../components/EmptyState.svelte'
  import { formatDateTime } from '../../lib/date'
  import type { FeedSource } from '../../types'
  import { setEntryRead, toggleEntryStar } from './feedState.svelte'

  interface Props {
    kind: FeedSource['kind']
  }

  let { kind }: Props = $props()
  let entry = $derived.by(() => {
    const feedIds = new Set(appState.feeds.filter((item) => item.kind === kind).map((item) => item.id))
    return Object.values(appState.entries)
      .flat()
      .find((item) => item.id === appState.selectedEntryId && feedIds.has(item.feedId))
  })
  let feed = $derived(appState.feeds.find((item) => item.id === entry?.feedId))
  let content = $state('')
  let sanitizeRequest = 0

  $effect(() => {
    const source = entry?.content ?? ''
    const request = ++sanitizeRequest
    if (!source) {
      content = ''
      return
    }
    void import('../../lib/sanitize')
      .then(({ sanitizeFeedHtml }) => {
        if (request === sanitizeRequest) content = sanitizeFeedHtml(source)
      })
      .catch((error) => {
        if (request === sanitizeRequest) {
          content = ''
          showToast(`无法清洗文章内容：${String(error)}`, 'error')
        }
      })
  })

  function open(link?: string): void {
    if (!link) return
    try {
      const url = new URL(link)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅允许打开 HTTP 或 HTTPS 链接')
      void openUrl(url).catch((error) => showToast(`无法打开链接：${String(error)}`, 'error'))
    } catch (error) {
      showToast(`无法打开链接：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  function setRead(isRead: boolean): void {
    if (!entry) return
    void setEntryRead(entry.id, isRead).catch((error) => showToast(`无法保存状态：${String(error)}`, 'error'))
  }

  function toggleStar(): void {
    if (!entry) return
    void toggleEntryStar(entry.id).catch((error) => showToast(`无法保存状态：${String(error)}`, 'error'))
  }

  function openContentLink(event: MouseEvent): void {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    try {
      const resolved = new URL(href, entry?.url ?? feed?.siteUrl ?? feed?.feedUrl).toString()
      open(resolved)
    } catch {
      showToast('无法识别正文中的链接', 'error')
    }
  }

  function routeContentLinks(node: HTMLElement): { destroy: () => void } {
    node.addEventListener('click', openContentLink)
    return { destroy: () => node.removeEventListener('click', openContentLink) }
  }
</script>

<section class="reader">
  {#if entry}
    <header>
      <div class="source-line">
        <span>{feed?.title || '未知来源'}</span>
        <time>{formatDateTime(entry.publishedAt ?? entry.fetchedAt)}</time>
      </div>
      <h2>{entry.title}</h2>
      {#if entry.author}<p class="author">{entry.author}</p>{/if}
      <div class="actions">
        {#if entry.url}
          <button class="primary" onclick={() => open(entry?.url)}><ExternalLink />打开原文</button>
        {/if}
        {#if entry.pdfUrl}
          <button class="secondary" onclick={() => open(entry?.pdfUrl)}><FileText />打开 PDF</button>
        {/if}
        <button class="secondary" onclick={() => setRead(!entry?.isRead)}>
          {#if entry.isRead}<Mail />标为未读{:else}<MailOpen />标为已读{/if}
        </button>
        <button class="secondary" class:starred={entry.isStarred} onclick={toggleStar}>
          <Star fill={entry.isStarred ? 'currentColor' : 'none'} />{entry.isStarred ? '取消收藏' : '收藏'}
        </button>
      </div>
    </header>
    <article class="content">
      {#if content}
        <div class="feed-content" use:routeContentLinks>{@html content}</div>
      {:else if entry.summary}
        <p>{entry.summary}</p>
      {:else}
        <p class="muted">此 Feed 没有提供摘要或正文，请打开原文查看。</p>
      {/if}
    </article>
  {:else}
    <EmptyState icon={FileText} title="选择一篇文章" description="文章内容与可用操作会显示在这里。" />
  {/if}
</section>

<style>
  .reader { min-width: 0; flex: 1; overflow: auto; background: var(--surface-raised); }
  header { padding: 28px clamp(26px, 4vw, 58px) 23px; border-bottom: 1px solid var(--border); }
  .source-line { display: flex; align-items: center; gap: 12px; margin-bottom: 13px; color: var(--text-subtle); font-size: 11px; }
  .source-line span { color: var(--accent); font-weight: 650; }
  h2 { max-width: 820px; margin: 0; color: var(--text-primary); font: 650 clamp(20px, 2vw, 28px)/1.32 var(--font-serif); letter-spacing: 0; }
  .author { margin: 11px 0 0; color: var(--text-muted); font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 20px; }
  .actions button { height: 31px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; }
  .actions button :global(svg) { width: 14px; height: 14px; }
  .actions .starred { color: var(--star); }
  .content { max-width: 850px; padding: 29px clamp(26px, 4vw, 58px) 60px; color: var(--reading-text); font: 15px/1.78 var(--font-serif); }
  .content p { margin: 0 0 1em; }
  .muted { color: var(--text-subtle); }
  .feed-content :global(p) { margin: 0 0 1em; }
  .feed-content :global(h1), .feed-content :global(h2), .feed-content :global(h3), .feed-content :global(h4) { margin: 1.3em 0 .6em; color: var(--text-primary); font-family: var(--font-sans); line-height: 1.35; }
  .feed-content :global(a) { color: var(--link); }
  .feed-content :global(pre) { overflow: auto; padding: 13px; background: var(--code-bg); border: 1px solid var(--border); border-radius: 5px; font: 12px/1.55 var(--font-mono); }
  .feed-content :global(code) { font-family: var(--font-mono); }
  .feed-content :global(blockquote) { margin: 1em 0; padding-left: 16px; color: var(--text-muted); border-left: 3px solid var(--border-strong); }
  .feed-content { min-width: 0; overflow-wrap: anywhere; }
  .feed-content :global(table) { display: block; width: 100%; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-family: var(--font-sans); font-size: 12px; }
  .feed-content :global(th), .feed-content :global(td) { padding: 7px; border: 1px solid var(--border); overflow-wrap: anywhere; }
</style>
