<script lang="ts">
  import {
    Download,
    Inbox,
    Mail,
    Pencil,
    Plus,
    RefreshCw,
    Star,
    Trash2,
    Upload,
  } from '@lucide/svelte'
  import { appState } from '../../app/state.svelte'
  import IconButton from '../../components/IconButton.svelte'
  import type { FeedSource } from '../../types'
  import { unreadCount } from './feedState.svelte'

  interface Props {
    kind: FeedSource['kind']
    scope: string
    onscope: (scope: string) => void
    onadd: () => void
    onrefreshall: () => void
    onrefreshfeed: (feedId: string) => void
    onedit: (feed: FeedSource) => void
    ondelete: (feed: FeedSource) => void
    onimport?: () => void
    onexport?: () => void
  }

  let {
    kind,
    scope,
    onscope,
    onadd,
    onrefreshall,
    onrefreshfeed,
    onedit,
    ondelete,
    onimport,
    onexport,
  }: Props = $props()

  let feeds = $derived(appState.feeds.filter((feed) => feed.kind === kind))
  let groupedFeeds = $derived.by(() => {
    const groups = new Map<string, FeedSource[]>()
    for (const feed of feeds) {
      const folder = feed.folder?.trim() || ''
      groups.set(folder, [...(groups.get(folder) ?? []), feed])
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
  })
  let allEntries = $derived(feeds.flatMap((feed) => appState.entries[feed.id] ?? []))
</script>

<aside class="feed-sidebar">
  <div class="filters">
    <button class:active={scope === 'all'} onclick={() => onscope('all')}>
      <Inbox /><span>全部</span><small>{allEntries.length}</small>
    </button>
    <button class:active={scope === 'unread'} onclick={() => onscope('unread')}>
      <Mail /><span>未读</span><small>{allEntries.filter((entry) => !entry.isRead).length}</small>
    </button>
    <button class:active={scope === 'starred'} onclick={() => onscope('starred')}>
      <Star /><span>收藏</span><small>{allEntries.filter((entry) => entry.isStarred).length}</small>
    </button>
  </div>

  <div class="section-heading">
    <span>{kind === 'arxiv' ? '论文订阅' : '订阅源'}</span>
    <div>
      <IconButton label="添加订阅" onclick={onadd}><Plus /></IconButton>
      <IconButton label="刷新全部" onclick={onrefreshall} disabled={appState.refreshingAll}>
        <RefreshCw class={appState.refreshingAll ? 'spinning' : ''} />
      </IconButton>
    </div>
  </div>

  <div class="feed-groups">
    {#if feeds.length === 0}
      <p class="no-feeds">还没有订阅</p>
    {/if}
    {#each groupedFeeds as [folder, folderFeeds]}
      {#if folder}<h3>{folder}</h3>{/if}
      {#each folderFeeds as feed (feed.id)}
        <div class="feed-row" class:active={scope === `feed:${feed.id}`} class:error={Boolean(feed.errorMessage)}>
          <button class="feed-select" onclick={() => onscope(`feed:${feed.id}`)} title={feed.errorMessage ?? feed.title}>
            <span>{feed.title || feed.feedUrl}</span>
            <small>{unreadCount(feed.id)}</small>
          </button>
          <div class="feed-actions">
            <IconButton label="刷新" onclick={() => onrefreshfeed(feed.id)} disabled={appState.refreshingFeedIds.includes(feed.id)}>
              <RefreshCw class={appState.refreshingFeedIds.includes(feed.id) ? 'spinning' : ''} />
            </IconButton>
            <IconButton label="编辑" onclick={() => onedit(feed)}><Pencil /></IconButton>
            <IconButton label="删除" onclick={() => ondelete(feed)}><Trash2 /></IconButton>
          </div>
        </div>
      {/each}
    {/each}
  </div>

  {#if onimport || onexport}
    <div class="opml-actions">
      {#if onimport}
        <button onclick={onimport}><Upload />导入 OPML</button>
      {/if}
      {#if onexport}
        <button onclick={onexport} disabled={!feeds.length}><Download />导出 OPML</button>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .feed-sidebar {
    width: 236px;
    min-width: 210px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface-muted);
    border-right: 1px solid var(--border);
  }

  .filters { display: grid; gap: 2px; padding: 10px 9px 8px; border-bottom: 1px solid var(--border); }
  .filters button,
  .feed-select {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    color: var(--text-muted);
    background: transparent;
    border: 0;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
  }
  .filters button { height: 34px; padding: 0 9px; }
  .filters button:hover,
  .filters button.active { color: var(--text-primary); background: var(--surface-hover); }
  .filters button :global(svg) { width: 15px; height: 15px; }
  .filters span,
  .feed-select span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { color: var(--text-subtle); font-size: 10px; font-variant-numeric: tabular-nums; }

  .section-heading { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 7px 0 14px; }
  .section-heading > span,
  h3 { color: var(--text-subtle); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  .section-heading > div { display: flex; }
  .feed-groups { flex: 1; overflow: auto; padding: 0 7px 10px; }
  h3 { margin: 11px 7px 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .feed-row { position: relative; min-height: 34px; border-radius: 5px; }
  .feed-row:hover,
  .feed-row.active { background: var(--surface-hover); }
  .feed-row.error::before { content: ''; position: absolute; left: 5px; top: 14px; width: 5px; height: 5px; border-radius: 50%; background: var(--danger); }
  .feed-select { width: 100%; height: 34px; padding: 0 8px 0 12px; }
  .feed-row.error .feed-select { padding-left: 18px; }
  .feed-actions { position: absolute; inset: 1px 3px 1px auto; display: none; align-items: center; background: var(--surface-hover); }
  .feed-actions :global(button) { width: 26px; height: 26px; flex-basis: 26px; }
  .feed-row:hover .feed-actions,
  .feed-row:focus-within .feed-actions { display: flex; }
  .feed-row:hover .feed-select small,
  .feed-row:focus-within .feed-select small { visibility: hidden; }
  .no-feeds { margin: 18px 8px; color: var(--text-subtle); font-size: 11px; }

  .opml-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; padding: 8px; border-top: 1px solid var(--border); }
  .opml-actions button { min-width: 0; height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 5px; color: var(--text-subtle); background: transparent; border: 0; border-radius: 4px; font-size: 10px; cursor: pointer; }
  .opml-actions button:hover:not(:disabled) { color: var(--text-primary); background: var(--surface-hover); }
  .opml-actions button:disabled { opacity: .4; cursor: default; }
  .opml-actions button :global(svg) { width: 13px; height: 13px; }
  :global(.spinning) { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
