<script lang="ts">
  import { Trash2 } from '@lucide/svelte'
  import { appState, showToast } from '../../app/state.svelte'
  import Modal from '../../components/Modal.svelte'
  import { chooseTextFile, saveTextFile } from '../../lib/files'
  import type { FeedSource } from '../../types'
  import AddFeedDialog from './AddFeedDialog.svelte'
  import EntryList from './EntryList.svelte'
  import EntryReader from './EntryReader.svelte'
  import FeedSidebar from './FeedSidebar.svelte'
  import {
    addFeed,
    refreshAllFeeds,
    refreshOneFeed,
    removeFeed,
    updateFeed,
  } from './feedState.svelte'
  import { exportOpmlDocument, importOpmlDocument } from './opml'

  let scope = $state('all')
  let showAdd = $state(false)
  let editing = $state<FeedSource | null>(null)
  let deleting = $state<FeedSource | null>(null)
  let importing = $state(false)
  let deleteLoading = $state(false)
  let deleteError = $state('')

  function changeScope(value: string): void {
    scope = value
    if (value.startsWith('feed:')) appState.selectedFeedId = value.slice(5)
  }

  async function createFeed(value: { title: string; feedUrl: string; folder?: string }): Promise<void> {
    const added = await addFeed({ kind: 'rss', ...value })
    scope = `feed:${added.id}`
    if (added.errorMessage) showToast(added.errorMessage, 'error')
    else showToast('订阅已添加', 'success')
  }

  async function editFeed(value: { title: string; feedUrl: string; folder?: string }): Promise<void> {
    if (!editing) return
    await updateFeed(editing.id, { title: value.title || editing.title, folder: value.folder })
    showToast('订阅信息已保存', 'success')
  }

  function refreshFeed(feedId: string): void {
    void refreshOneFeed(feedId)
      .then((ok) => {
        const feed = appState.feeds.find((item) => item.id === feedId)
        showToast(ok ? '订阅已刷新' : feed?.errorMessage || '订阅刷新失败', ok ? 'success' : 'error')
      })
      .catch((error) => showToast(`订阅刷新失败：${String(error)}`, 'error'))
  }

  function refreshAll(): void {
    void refreshAllFeeds('rss')
      .then(({ success, failed }) => {
        if (failed) showToast(`刷新完成：${success} 个成功，${failed} 个失败`, 'error')
        else showToast(success ? `已刷新 ${success} 个订阅` : '没有可刷新的订阅', 'success')
      })
      .catch((error) => showToast(`刷新失败：${String(error)}`, 'error'))
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting || deleteLoading) return
    const title = deleting.title
    deleteLoading = true
    deleteError = ''
    try {
      await removeFeed(deleting.id)
      deleting = null
      if (scope.startsWith('feed:')) scope = 'all'
      showToast(`已删除“${title}”`, 'success')
    } catch (error) {
      deleteError = error instanceof Error ? error.message : String(error)
    } finally {
      deleteLoading = false
    }
  }

  async function importOpml(): Promise<void> {
    importing = true
    try {
      const source = await chooseTextFile({ title: '导入 OPML', extensions: ['opml', 'xml'] })
      if (!source) return
      const imported = importOpmlDocument(source)
      let added = 0
      let skipped = 0
      for (const item of imported) {
        try {
          await addFeed({ kind: 'rss', ...item })
          added += 1
        } catch {
          skipped += 1
        }
      }
      showToast(`OPML 导入完成：新增 ${added} 个，跳过 ${skipped} 个`, skipped ? 'info' : 'success')
    } catch (error) {
      showToast(`OPML 导入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      importing = false
    }
  }

  async function exportOpml(): Promise<void> {
    try {
      const feeds = appState.feeds.filter((feed) => feed.kind === 'rss')
      const saved = await saveTextFile(exportOpmlDocument(feeds), {
        title: '导出 OPML',
        defaultPath: 'research-desk-subscriptions.opml',
        extensions: ['opml'],
      })
      if (saved) showToast('OPML 已导出', 'success')
    } catch (error) {
      showToast(`OPML 导出失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }
</script>

<div class="feed-page" aria-busy={importing}>
  <FeedSidebar
    kind="rss"
    {scope}
    onscope={changeScope}
    onadd={() => (showAdd = true)}
    onrefreshall={refreshAll}
    onrefreshfeed={refreshFeed}
    onedit={(feed) => (editing = feed)}
    ondelete={(feed) => {
      deleteError = ''
      deleting = feed
    }}
    onimport={importOpml}
    onexport={exportOpml}
  />
  <EntryList kind="rss" {scope} />
  <EntryReader kind="rss" />
</div>

{#if showAdd}
  <AddFeedDialog onclose={() => (showAdd = false)} onsubmit={createFeed} />
{/if}
{#if editing}
  <AddFeedDialog feed={editing} onclose={() => (editing = null)} onsubmit={editFeed} />
{/if}
{#if deleting}
  <Modal title="删除订阅" onclose={() => (deleting = null)}>
    <div class="confirm">
      <Trash2 />
      <p>删除“{deleting.title}”及其本地文章记录？此操作无法撤销。</p>
      {#if deleteError}<p class="delete-error" role="alert">{deleteError}</p>{/if}
      <footer>
        <button class="secondary" onclick={() => (deleting = null)} disabled={deleteLoading}>取消</button>
        <button class="danger" onclick={() => void confirmDelete()} disabled={deleteLoading}>{deleteLoading ? '删除中…' : '删除'}</button>
      </footer>
    </div>
  </Modal>
{/if}

<style>
  .feed-page { min-height: 0; flex: 1; display: flex; overflow: hidden; }
  .confirm { display: grid; justify-items: center; gap: 13px; text-align: center; }
  .confirm > :global(svg) { width: 26px; height: 26px; color: var(--danger); }
  .confirm p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
  .confirm .delete-error { color: var(--danger); font-size: 11px; }
  footer { display: flex; gap: 8px; margin-top: 7px; }
</style>
