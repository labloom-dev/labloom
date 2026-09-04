<script lang="ts">
  import { Search, Star } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { appState, showToast } from '../../app/state.svelte'
  import { formatRelativeDate } from '../../lib/date'
  import type { FeedEntry, FeedSource } from '../../types'
  import { setEntryRead, toggleEntryStar } from './feedState.svelte'

  interface Props {
    kind: FeedSource['kind']
    scope: string
  }

  let { kind, scope }: Props = $props()
  let query = $state('')
  let now = $state(Date.now())
  let sourceNames = $derived(new Map(appState.feeds.map((feed) => [feed.id, feed.title])))
  let entries = $derived.by(() => {
    const feedIds = new Set(appState.feeds.filter((feed) => feed.kind === kind).map((feed) => feed.id))
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return Object.values(appState.entries)
      .flat()
      .filter((entry) => feedIds.has(entry.feedId))
      .filter((entry) => {
        if (scope === 'unread' && entry.isRead) return false
        if (scope === 'starred' && !entry.isStarred) return false
        if (scope.startsWith('feed:') && entry.feedId !== scope.slice(5)) return false
        if (!normalizedQuery) return true
        return [entry.title, entry.author, entry.summary].some((value) =>
          value?.toLocaleLowerCase().includes(normalizedQuery),
        )
      })
      .sort((left, right) => (right.publishedAt ?? right.fetchedAt) - (left.publishedAt ?? left.fetchedAt))
  })

  $effect(() => {
    const visibleEntries = entries
    if (visibleEntries.length && !visibleEntries.some((entry) => entry.id === appState.selectedEntryId)) {
      appState.selectedEntryId = visibleEntries[0].id
      appState.selectedFeedId = visibleEntries[0].feedId
    }
  })

  onMount(() => {
    const timer = window.setInterval(() => (now = Date.now()), 60_000)
    return () => window.clearInterval(timer)
  })

  function selectEntry(entry: FeedEntry): void {
    appState.selectedEntryId = entry.id
    appState.selectedFeedId = entry.feedId
    if (!entry.isRead) {
      void setEntryRead(entry.id, true).catch((error) => showToast(`无法保存已读状态：${String(error)}`, 'error'))
    }
  }

  function star(event: MouseEvent, entry: FeedEntry): void {
    event.stopPropagation()
    void toggleEntryStar(entry.id).catch((error) => showToast(`无法保存收藏状态：${String(error)}`, 'error'))
  }
</script>

<section class="entry-list">
  <div class="search">
    <Search />
    <input bind:value={query} aria-label="搜索文章" placeholder="搜索标题、作者或摘要" />
    <span>{entries.length}</span>
  </div>
  <div class="entries">
    {#if entries.length === 0}
      <p class="empty">{query ? '没有匹配的文章' : '暂无文章'}</p>
    {/if}
    {#each entries as entry (entry.id)}
      <article class:selected={appState.selectedEntryId === entry.id} class:unread={!entry.isRead}>
        <button class="entry-main" onclick={() => selectEntry(entry)}>
          <span class="status" aria-hidden="true"></span>
          <div class="meta">
            <span class="source">{sourceNames.get(entry.feedId) || '未知来源'}</span>
            <time>{formatRelativeDate(entry.publishedAt ?? entry.fetchedAt, now)}</time>
          </div>
          <h3>{entry.title}</h3>
          {#if entry.author}<p class="author">{entry.author}</p>{/if}
          {#if entry.summary}<p class="summary">{entry.summary}</p>{/if}
        </button>
        <button class="star" class:active={entry.isStarred} onclick={(event) => star(event, entry)} aria-label={entry.isStarred ? '取消收藏' : '收藏'} title={entry.isStarred ? '取消收藏' : '收藏'}>
          <Star fill={entry.isStarred ? 'currentColor' : 'none'} />
        </button>
      </article>
    {/each}
  </div>
</section>

<style>
  .entry-list { width: clamp(320px, 31vw, 460px); min-width: 310px; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); border-right: 1px solid var(--border); }
  .search { height: 48px; flex: 0 0 48px; display: flex; align-items: center; gap: 8px; padding: 0 13px; border-bottom: 1px solid var(--border); }
  .search :global(svg) { width: 15px; height: 15px; color: var(--text-subtle); }
  .search input { min-width: 0; flex: 1; height: 30px; padding: 0; background: transparent; border: 0; outline: 0; }
  .search span { color: var(--text-subtle); font-size: 10px; font-variant-numeric: tabular-nums; }
  .entries { flex: 1; overflow: auto; }
  article { position: relative; min-height: 126px; border-bottom: 1px solid var(--border); }
  article:hover { background: var(--surface-hover-soft); }
  article.selected { background: var(--selection); box-shadow: inset 3px 0 var(--accent); }
  .entry-main { width: 100%; min-height: 126px; display: block; padding: 14px 42px 13px 18px; color: inherit; background: transparent; border: 0; text-align: left; cursor: pointer; }
  .status { position: absolute; left: 8px; top: 20px; width: 5px; height: 5px; border-radius: 50%; background: transparent; }
  article.unread .status { background: var(--accent); }
  .meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 5px; color: var(--text-subtle); font-size: 10px; }
  .source { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  time { flex: 0 0 auto; }
  h3 { display: -webkit-box; overflow: hidden; margin: 0 0 5px; color: var(--text-primary); font-size: 13px; font-weight: 570; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  article.unread h3 { font-weight: 690; }
  p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .author { margin-bottom: 5px; color: var(--text-muted); font-size: 10px; }
  .summary { display: -webkit-box; color: var(--text-subtle); font-size: 11px; line-height: 1.5; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  .star { position: absolute; top: 37px; right: 10px; width: 27px; height: 27px; display: grid; place-items: center; padding: 0; color: var(--text-subtle); background: transparent; border: 0; border-radius: 4px; cursor: pointer; }
  .star:hover { color: var(--text-primary); background: var(--surface-hover); }
  .star.active { color: var(--star); }
  .star :global(svg) { width: 15px; height: 15px; }
  .empty { padding: 42px 20px; color: var(--text-subtle); font-size: 12px; text-align: center; }
</style>
