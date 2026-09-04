<script lang="ts">
  import { Folder, FolderOpen, Library, RefreshCw } from '@lucide/svelte'
  import { appState } from '../../app/state.svelte'
  import IconButton from '../../components/IconButton.svelte'
  import type { ZoteroCollection } from '../../types'

  interface Props {
    selectedKey: string | null
    loading: boolean
    onselect: (key: string | null) => void
    onrefresh: () => void
  }

  interface CollectionRow {
    collection: ZoteroCollection
    depth: number
  }

  let { selectedKey, loading, onselect, onrefresh }: Props = $props()

  let rows = $derived.by(() => {
    const children = new Map<string, ZoteroCollection[]>()
    const collectionKeys = new Set(appState.zoteroCollections.map((collection) => collection.key))
    for (const collection of appState.zoteroCollections) {
      const parent = collection.parentCollection && collectionKeys.has(collection.parentCollection)
        ? collection.parentCollection
        : ''
      children.set(parent, [...(children.get(parent) ?? []), collection])
    }
    for (const group of children.values()) {
      group.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    }

    const result: CollectionRow[] = []
    const visited = new Set<string>()
    const append = (parent: string, depth: number): void => {
      for (const collection of children.get(parent) ?? []) {
        if (visited.has(collection.key)) continue
        visited.add(collection.key)
        result.push({ collection, depth })
        append(collection.key, depth + 1)
      }
    }
    append('', 0)
    for (const collection of appState.zoteroCollections) {
      if (!visited.has(collection.key)) result.push({ collection, depth: 0 })
    }
    return result
  })

  function itemCount(collectionKey: string): number {
    return appState.zoteroItems.filter((item) => item.collections.includes(collectionKey)).length
  }
</script>

<aside class="collection-list" aria-label="Zotero 分类">
  <div class="heading">
    <span>文献库</span>
    <IconButton label="刷新 Zotero" onclick={onrefresh} disabled={loading}>
      <RefreshCw class={loading ? 'spinning' : ''} />
    </IconButton>
  </div>

  <nav>
    <button class:active={selectedKey === null} onclick={() => onselect(null)}>
      <Library />
      <span>全部条目</span>
      <small>{appState.zoteroItems.length}</small>
    </button>

    {#each rows as row (row.collection.key)}
      <button
        class:active={selectedKey === row.collection.key}
        class="collection"
        style:--indent={`${Math.min(row.depth, 5) * 14}px`}
        onclick={() => onselect(row.collection.key)}
        title={row.collection.name}
      >
        {#if selectedKey === row.collection.key}<FolderOpen />{:else}<Folder />{/if}
        <span>{row.collection.name}</span>
        <small>{itemCount(row.collection.key)}</small>
      </button>
    {/each}
  </nav>

  {#if appState.zoteroCollections.length === 0 && !loading}
    <p class="empty">没有分类</p>
  {/if}
</aside>

<style>
  .collection-list {
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface-muted);
    border-right: 1px solid var(--border);
  }

  .heading {
    height: 48px;
    flex: 0 0 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--border);
  }

  .heading > span {
    color: var(--text-subtle);
    font-size: 10px;
    font-weight: 650;
    text-transform: uppercase;
  }

  nav {
    overflow: auto;
    padding: 8px 7px;
  }

  nav button {
    width: 100%;
    height: 34px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 9px;
    color: var(--text-muted);
    background: transparent;
    border: 0;
    border-radius: 5px;
    text-align: left;
    cursor: pointer;
  }

  nav button.collection {
    padding-left: calc(9px + var(--indent));
  }

  nav button:hover,
  nav button.active {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  nav button.active {
    box-shadow: inset 2px 0 var(--accent);
  }

  nav button :global(svg) {
    width: 15px;
    height: 15px;
    flex: 0 0 15px;
  }

  nav span {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  small {
    color: var(--text-subtle);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    margin: 10px 16px;
    color: var(--text-subtle);
    font-size: 11px;
  }

  :global(.spinning) {
    animation: spin .8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
