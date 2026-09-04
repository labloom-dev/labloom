<script lang="ts">
  import {
    ChevronRight,
    ExternalLink,
    FileText,
    Library,
    LoaderCircle,
    NotebookPen,
    RotateCw,
    Tags,
    Users,
  } from '@lucide/svelte'
  import type { Component } from 'svelte'
  import { appState, showToast } from '../../app/state.svelte'
  import EmptyState from '../../components/EmptyState.svelte'
  import type { ZoteroItem } from '../../types'
  import {
    loadZoteroItemDetails,
    openZoteroItem,
    openZoteroLink,
    zoteroAuthorNames,
    zoteroErrorMessage,
  } from './zotero'

  interface NotePanelProps {
    itemKey: string
    title: string
  }

  type NotePanelComponent = Component<NotePanelProps>

  let detailItem = $state<ZoteroItem | null>(null)
  let detailLoading = $state(false)
  let detailError = $state('')
  let detailRequest = 0
  let notesExpanded = $state(false)
  let notesLoading = $state(false)
  let notesError = $state('')
  let NotePanel = $state<NotePanelComponent | null>(null)

  let selectedItem = $derived(
    appState.zoteroItems.find((item) => item.key === appState.selectedZoteroItemKey),
  )
  let item = $derived(detailItem?.key === selectedItem?.key ? detailItem : selectedItem)
  let authors = $derived(item ? zoteroAuthorNames(item) : [])

  async function loadDetails(baseUrl: string, selected: ZoteroItem): Promise<void> {
    const request = ++detailRequest
    detailItem = selected
    detailLoading = true
    detailError = ''
    try {
      const loaded = await loadZoteroItemDetails(baseUrl, selected.key)
      if (request !== detailRequest) return
      detailItem = loaded
    } catch (error) {
      if (request === detailRequest) detailError = zoteroErrorMessage(error)
    } finally {
      if (request === detailRequest) detailLoading = false
    }
  }

  $effect(() => {
    const selected = selectedItem
    const baseUrl = appState.settings.zoteroBaseUrl
    notesExpanded = false
    notesError = ''
    if (!selected) {
      detailRequest += 1
      detailItem = null
      detailLoading = false
      detailError = ''
      return
    }
    void loadDetails(baseUrl, selected)
    return () => {
      detailRequest += 1
    }
  })

  async function toggleNotes(): Promise<void> {
    notesExpanded = !notesExpanded
    if (!notesExpanded || NotePanel || notesLoading) return

    await loadNotes()
  }

  async function loadNotes(): Promise<void> {
    if (NotePanel || notesLoading) return
    notesLoading = true
    notesError = ''
    try {
      NotePanel = (await import('../notes/NotePanel.svelte')).default
    } catch (error) {
      notesError = error instanceof Error ? error.message : String(error)
    } finally {
      notesLoading = false
    }
  }

  async function openItemInZotero(): Promise<void> {
    if (!item) return
    try {
      await openZoteroItem(item.key)
    } catch (error) {
      showToast(`无法在 Zotero 中打开：${zoteroErrorMessage(error)}`, 'error')
    }
  }

  async function openLink(url: string): Promise<void> {
    try {
      await openZoteroLink(url)
    } catch (error) {
      showToast(`无法打开链接：${zoteroErrorMessage(error)}`, 'error')
    }
  }
</script>

<section class="item-detail" aria-busy={detailLoading}>
  {#if item}
    <header>
      <div class="eyebrow">
        <span>{item.itemType}</span>
        {#if item.year}<time>{item.year}</time>{/if}
        {#if detailLoading}<LoaderCircle class="spinning" aria-label="正在加载条目详情" />{/if}
      </div>
      <h2>{item.title}</h2>
      <div class="authors"><Users /> <span>{authors.length ? authors.join(', ') : '未知作者'}</span></div>
      <div class="actions">
        <button class="primary" onclick={() => void openItemInZotero()}><Library />在 Zotero 中显示</button>
        {#if item.attachmentUrl}
          <button class="secondary" onclick={() => void openLink(item?.attachmentUrl ?? '')}>
            <FileText />打开 PDF / 附件
          </button>
        {/if}
        {#if item.url}
          <button class="secondary" onclick={() => void openLink(item?.url ?? '')}>
            <ExternalLink />打开原始链接
          </button>
        {/if}
      </div>
      {#if detailError}
        <div class="detail-error" role="alert">
          <span>详情刷新失败：{detailError}</span>
          <button onclick={() => selectedItem && void loadDetails(appState.settings.zoteroBaseUrl, selectedItem)}>
            <RotateCw />重试
          </button>
        </div>
      {/if}
    </header>

    <div class="content">
      <section class="abstract-section">
        <h3>摘要</h3>
        {#if item.abstractNote}
          <p>{item.abstractNote}</p>
        {:else}
          <p class="muted">此条目没有摘要。</p>
        {/if}
      </section>

      <section class="tag-section">
        <h3><Tags />标签</h3>
        {#if item.tags.length}
          <div class="tag-list">
            {#each item.tags as tag}<span>{tag}</span>{/each}
          </div>
        {:else}
          <p class="muted">无标签</p>
        {/if}
      </section>

      <section class="notes-section">
        <button class="notes-toggle" aria-expanded={notesExpanded} onclick={() => void toggleNotes()}>
          <ChevronRight class={notesExpanded ? 'expanded' : ''} />
          <NotebookPen />
          <span>笔记</span>
          {#if notesLoading}<LoaderCircle class="spinning" />{/if}
        </button>
        {#if notesExpanded}
          <div class="notes-body">
            {#if NotePanel}
              <NotePanel itemKey={item.key} title={item.title} />
            {:else if notesError}
              <div class="notes-error" role="alert">
                <span>{notesError}</span>
                <button onclick={() => void loadNotes()}><RotateCw />重试</button>
              </div>
            {:else}
              <span class="notes-loading">正在加载笔记...</span>
            {/if}
          </div>
        {/if}
      </section>
    </div>
  {:else}
    <EmptyState icon={FileText} title="选择一条文献" description="条目详情与可用附件会显示在这里。" />
  {/if}
</section>

<style>
  .item-detail {
    min-width: 0;
    height: 100%;
    overflow: auto;
    background: var(--surface-raised);
  }

  header {
    padding: 28px clamp(25px, 4vw, 56px) 23px;
    border-bottom: 1px solid var(--border);
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 16px;
    margin-bottom: 12px;
    color: var(--text-subtle);
    font-size: 10px;
    text-transform: uppercase;
  }

  .eyebrow span {
    color: var(--accent);
    font-weight: 650;
  }

  .eyebrow :global(svg) {
    width: 13px;
    height: 13px;
  }

  h2 {
    max-width: 860px;
    margin: 0;
    color: var(--text-primary);
    font: 650 25px/1.34 var(--font-serif);
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }

  .authors {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin-top: 11px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .authors :global(svg) {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    margin-top: 2px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 20px;
  }

  .actions button,
  .detail-error button,
  .notes-error button {
    height: 31px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
  }

  .actions button :global(svg),
  .detail-error button :global(svg),
  .notes-error button :global(svg) {
    width: 14px;
    height: 14px;
  }

  .detail-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 15px;
    padding: 8px 10px;
    color: var(--danger);
    background: var(--danger-soft);
    border: 1px solid color-mix(in srgb, var(--danger) 28%, transparent);
    border-radius: 5px;
    font-size: 11px;
  }

  .detail-error button,
  .notes-error button {
    flex: 0 0 auto;
    color: inherit;
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 4px;
    cursor: pointer;
  }

  .content {
    max-width: 900px;
    padding: 27px clamp(25px, 4vw, 56px) 60px;
  }

  .content > section + section {
    margin-top: 28px;
  }

  .content h3 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 10px;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 680;
  }

  .content h3 :global(svg) {
    width: 14px;
    height: 14px;
  }

  .abstract-section p {
    margin: 0;
    color: var(--reading-text);
    font: 14px/1.76 var(--font-serif);
    white-space: pre-wrap;
  }

  .muted {
    margin: 0;
    color: var(--text-subtle) !important;
    font-family: var(--font-sans) !important;
    font-size: 12px !important;
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tag-list span {
    max-width: 100%;
    overflow-wrap: anywhere;
    padding: 3px 7px;
    color: var(--text-muted);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 10px;
  }

  .notes-section {
    border-top: 1px solid var(--border);
  }

  .notes-toggle {
    width: 100%;
    height: 43px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0;
    color: var(--text-primary);
    background: transparent;
    border: 0;
    font-size: 12px;
    font-weight: 650;
    text-align: left;
    cursor: pointer;
  }

  .notes-toggle :global(svg) {
    width: 14px;
    height: 14px;
  }

  .notes-toggle :global(svg:first-child) {
    color: var(--text-subtle);
    transition: transform .15s ease;
  }

  .notes-toggle :global(svg:first-child.expanded) {
    transform: rotate(90deg);
  }

  .notes-toggle span {
    flex: 1;
  }

  .notes-body {
    min-height: 70px;
    padding: 2px 0 14px 21px;
  }

  .notes-loading {
    color: var(--text-subtle);
    font-size: 11px;
  }

  .notes-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--danger);
    font-size: 11px;
  }

  :global(.spinning) {
    animation: spin .8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 900px) {
    h2 { font-size: 22px; }
  }
</style>
