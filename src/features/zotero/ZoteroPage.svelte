<script lang="ts">
  import { LoaderCircle, RefreshCw, Unplug } from '@lucide/svelte'
  import { appState } from '../../app/state.svelte'
  import CollectionList from './CollectionList.svelte'
  import ZoteroItemDetail from './ZoteroItemDetail.svelte'
  import ZoteroItemList from './ZoteroItemList.svelte'
  import {
    checkZoteroConnection,
    filterZoteroItems,
    loadZoteroCollections,
    loadZoteroItems,
    ZOTERO_DISCONNECTED_MESSAGE,
    zoteroErrorMessage,
  } from './zotero'

  let selectedCollectionKey = $state<string | null>(null)
  let refreshRequest = 0

  async function refresh(baseUrl = appState.settings.zoteroBaseUrl): Promise<void> {
    const request = ++refreshRequest
    appState.zoteroLoading = true
    appState.zoteroError = ''

    const connected = await checkZoteroConnection(baseUrl)
    if (request !== refreshRequest) return
    if (!connected) {
      appState.zoteroConnected = false
      appState.zoteroCollections = []
      appState.zoteroItems = []
      appState.selectedZoteroItemKey = null
      appState.zoteroError = ZOTERO_DISCONNECTED_MESSAGE
      appState.zoteroLoading = false
      return
    }

    appState.zoteroConnected = true
    try {
      const [collections, items] = await Promise.all([
        loadZoteroCollections(baseUrl),
        loadZoteroItems(baseUrl),
      ])
      if (request !== refreshRequest) return
      appState.zoteroCollections = collections
      appState.zoteroItems = items

      if (selectedCollectionKey && !collections.some((collection) => collection.key === selectedCollectionKey)) {
        selectedCollectionKey = null
      }
      const visible = filterZoteroItems(items, '', selectedCollectionKey)
      if (!visible.some((item) => item.key === appState.selectedZoteroItemKey)) {
        appState.selectedZoteroItemKey = visible[0]?.key ?? null
      }
    } catch (error) {
      if (request === refreshRequest) {
        appState.zoteroError = `无法加载 Zotero 文献库：${zoteroErrorMessage(error)}`
      }
    } finally {
      if (request === refreshRequest) appState.zoteroLoading = false
    }
  }

  function selectCollection(key: string | null): void {
    selectedCollectionKey = key
    const visible = filterZoteroItems(appState.zoteroItems, '', key)
    if (!visible.some((item) => item.key === appState.selectedZoteroItemKey)) {
      appState.selectedZoteroItemKey = visible[0]?.key ?? null
    }
  }

  $effect(() => {
    const baseUrl = appState.settings.zoteroBaseUrl
    void refresh(baseUrl)
    return () => {
      refreshRequest += 1
    }
  })
</script>

<div class="zotero-page" aria-busy={appState.zoteroLoading}>
  {#if appState.zoteroLoading && !appState.zoteroConnected}
    <div class="status-state">
      <LoaderCircle class="spinning" />
      <strong>正在连接 Zotero...</strong>
      <p>正在读取本机文献库</p>
    </div>
  {:else if !appState.zoteroConnected}
    <div class="status-state disconnected" role="alert">
      <Unplug />
      <strong>Zotero 未连接</strong>
      <p>{ZOTERO_DISCONNECTED_MESSAGE}</p>
      <button class="primary" onclick={() => void refresh()}><RefreshCw />重试</button>
    </div>
  {:else}
    {#if appState.zoteroError}
      <div class="error-banner" role="alert">
        <span>{appState.zoteroError}</span>
        <button onclick={() => void refresh()} disabled={appState.zoteroLoading}>
          <RefreshCw class={appState.zoteroLoading ? 'spinning' : ''} />重试
        </button>
      </div>
    {/if}
    {#if appState.zoteroLoading}<div class="loading-bar" aria-hidden="true"></div>{/if}

    <div class="collection-pane">
      <CollectionList
        selectedKey={selectedCollectionKey}
        loading={appState.zoteroLoading}
        onselect={selectCollection}
        onrefresh={() => void refresh()}
      />
    </div>
    <div class="list-pane"><ZoteroItemList collectionKey={selectedCollectionKey} /></div>
    <div class="detail-pane"><ZoteroItemDetail /></div>
  {/if}
</div>

<style>
  .zotero-page {
    position: relative;
    min-width: 0;
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: 220px minmax(320px, 410px) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    background: var(--surface);
  }

  .collection-pane,
  .list-pane,
  .detail-pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .collection-pane { grid-column: 1; grid-row: 2; }
  .list-pane { grid-column: 2; grid-row: 2; }
  .detail-pane { grid-column: 3; grid-row: 2; }

  .status-state {
    grid-column: 1 / -1;
    min-height: 340px;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 9px;
    padding: 32px;
    color: var(--text-muted);
    text-align: center;
  }

  .status-state > :global(svg) {
    width: 30px;
    height: 30px;
    stroke-width: 1.5;
  }

  .status-state strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 650;
  }

  .status-state p {
    max-width: 440px;
    margin: 0;
    color: var(--text-subtle);
    font-size: 12px;
    line-height: 1.6;
  }

  .status-state button {
    height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 9px;
    padding: 0 12px;
  }

  .status-state button :global(svg) {
    width: 14px;
    height: 14px;
  }

  .error-banner {
    z-index: 4;
    grid-column: 1 / -1;
    grid-row: 1;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin: 7px 10px;
    padding: 5px 7px 5px 12px;
    color: var(--danger);
    background: var(--surface-raised);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
    border-radius: 5px;
    box-shadow: 0 4px 14px rgb(0 0 0 / 10%);
    font-size: 11px;
  }

  .error-banner button {
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 7px;
    color: inherit;
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 4px;
    cursor: pointer;
  }

  .error-banner button :global(svg) {
    width: 12px;
    height: 12px;
  }

  .loading-bar {
    position: absolute;
    z-index: 5;
    top: 0;
    right: 0;
    left: 0;
    height: 2px;
    overflow: hidden;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .loading-bar::after {
    content: '';
    position: absolute;
    width: 35%;
    height: 100%;
    background: var(--accent);
    animation: progress 1.1s ease-in-out infinite;
  }

  :global(.spinning) {
    animation: spin .8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes progress {
    from { transform: translateX(-110%); }
    to { transform: translateX(310%); }
  }

  @media (max-width: 900px) {
    .zotero-page {
      grid-template-columns: 190px minmax(290px, 1fr);
      grid-template-rows: auto minmax(380px, 52vh) minmax(440px, auto);
      overflow: auto;
    }

    .detail-pane {
      grid-column: 1 / -1;
      grid-row: 3;
      min-height: 440px;
      border-top: 1px solid var(--border);
    }

    .collection-pane { grid-row: 2; }
    .list-pane { grid-row: 2; }
  }

  @media (max-width: 560px) {
    .zotero-page {
      display: block;
      overflow: auto;
    }

    .collection-pane {
      height: 230px;
    }

    .list-pane {
      height: 430px;
      border-top: 1px solid var(--border);
    }

    .detail-pane {
      min-height: 520px;
      overflow: visible;
    }

    .error-banner {
      position: sticky;
      top: 0;
      right: auto;
      left: auto;
      border-radius: 0;
    }
  }
</style>
