<script lang="ts">
  import { FileText, Search } from '@lucide/svelte'
  import { appState } from '../../app/state.svelte'
  import type { ZoteroItem } from '../../types'
  import { filterZoteroItems, zoteroAuthorNames } from './zotero'

  interface Props {
    collectionKey: string | null
  }

  let { collectionKey }: Props = $props()
  let query = $state('')
  let items = $derived(filterZoteroItems(appState.zoteroItems, query, collectionKey))

  $effect(() => {
    const visibleItems = items
    if (!visibleItems.some((item) => item.key === appState.selectedZoteroItemKey)) {
      appState.selectedZoteroItemKey = visibleItems[0]?.key ?? null
    }
  })

  function selectItem(item: ZoteroItem): void {
    appState.selectedZoteroItemKey = item.key
  }

  function itemTypeLabel(itemType: string): string {
    const labels: Record<string, string> = {
      artwork: '艺术作品',
      audioRecording: '音频',
      bill: '法案',
      blogPost: '博客',
      book: '图书',
      bookSection: '书籍章节',
      case: '案例',
      conferencePaper: '会议论文',
      dictionaryEntry: '词典条目',
      document: '文档',
      encyclopediaArticle: '百科条目',
      film: '影片',
      forumPost: '论坛帖子',
      hearing: '听证会',
      instantMessage: '即时消息',
      interview: '访谈',
      journalArticle: '期刊论文',
      letter: '信件',
      magazineArticle: '杂志文章',
      manuscript: '手稿',
      map: '地图',
      newspaperArticle: '报纸文章',
      patent: '专利',
      podcast: '播客',
      presentation: '演示文稿',
      radioBroadcast: '广播',
      report: '报告',
      statute: '法规',
      thesis: '学位论文',
      tvBroadcast: '电视节目',
      videoRecording: '视频',
      webpage: '网页',
    }
    return labels[itemType] ?? '文献'
  }
</script>

<section class="item-list" aria-label="Zotero 条目">
  <label class="search">
    <Search />
    <input bind:value={query} aria-label="搜索 Zotero 条目" placeholder="搜索标题或作者" />
    <span>{items.length}</span>
  </label>

  <div class="items">
    {#if items.length === 0}
      <div class="empty">
        <FileText />
        <span>{query.trim() ? '没有匹配的条目' : '此分类中暂无条目'}</span>
      </div>
    {/if}

    {#each items as item (item.key)}
      {@const authors = zoteroAuthorNames(item)}
      <article class:selected={appState.selectedZoteroItemKey === item.key}>
        <button onclick={() => selectItem(item)} title={item.title}>
          <div class="meta">
            <span>{itemTypeLabel(item.itemType)}</span>
            {#if item.year}<time>{item.year}</time>{/if}
          </div>
          <h3>{item.title}</h3>
          <p class="authors">{authors.length ? authors.join(', ') : '未知作者'}</p>
          {#if item.tags.length}
            <div class="tags" aria-label="标签">
              {#each item.tags.slice(0, 2) as tag}<span>{tag}</span>{/each}
              {#if item.tags.length > 2}<small>+{item.tags.length - 2}</small>{/if}
            </div>
          {/if}
        </button>
      </article>
    {/each}
  </div>
</section>

<style>
  .item-list {
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
    border-right: 1px solid var(--border);
  }

  .search {
    height: 48px;
    flex: 0 0 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 13px;
    border-bottom: 1px solid var(--border);
  }

  .search :global(svg) {
    width: 15px;
    height: 15px;
    color: var(--text-subtle);
  }

  .search input {
    min-width: 0;
    flex: 1;
    height: 30px;
    padding: 0;
    background: transparent;
    border: 0;
    outline: 0;
  }

  .search > span {
    color: var(--text-subtle);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .items {
    flex: 1;
    overflow: auto;
  }

  article {
    min-height: 112px;
    border-bottom: 1px solid var(--border);
  }

  article:hover {
    background: var(--surface-hover-soft);
  }

  article.selected {
    background: var(--selection);
    box-shadow: inset 3px 0 var(--accent);
  }

  article > button {
    width: 100%;
    min-height: 112px;
    display: block;
    padding: 13px 17px 12px;
    color: inherit;
    background: transparent;
    border: 0;
    text-align: left;
    cursor: pointer;
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 5px;
    color: var(--text-subtle);
    font-size: 10px;
  }

  h3 {
    display: -webkit-box;
    overflow: hidden;
    margin: 0 0 6px;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 640;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .authors {
    overflow: hidden;
    margin: 0;
    color: var(--text-muted);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tags {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 18px;
    margin-top: 8px;
    overflow: hidden;
  }

  .tags span {
    max-width: 110px;
    overflow: hidden;
    padding: 1px 5px;
    color: var(--text-subtle);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tags small {
    color: var(--text-subtle);
    font-size: 9px;
  }

  .empty {
    min-height: 220px;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 9px;
    padding: 24px;
    color: var(--text-subtle);
    font-size: 12px;
    text-align: center;
  }

  .empty :global(svg) {
    width: 24px;
    height: 24px;
    stroke-width: 1.5;
  }
</style>
