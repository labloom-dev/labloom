<script lang="ts">
  import { Trash2 } from '@lucide/svelte'
  import { appState, showToast } from '../../app/state.svelte'
  import Modal from '../../components/Modal.svelte'
  import AddFeedDialog from '../feeds/AddFeedDialog.svelte'
  import EntryList from '../feeds/EntryList.svelte'
  import EntryReader from '../feeds/EntryReader.svelte'
  import FeedSidebar from '../feeds/FeedSidebar.svelte'
  import {
    addFeed,
    refreshAllFeeds,
    refreshOneFeed,
    removeFeed,
    updateFeed,
  } from '../feeds/feedState.svelte'
  import type { FeedSource } from '../../types'
  import AddArxivDialog from './AddArxivDialog.svelte'

  let scope = $state('all')
  let showAdd = $state(false)
  let editing = $state<FeedSource | null>(null)
  let deleting = $state<FeedSource | null>(null)
  let deleteLoading = $state(false)
  let deleteError = $state('')

  function changeScope(value: string): void {
    scope = value
    if (value.startsWith('feed:')) appState.selectedFeedId = value.slice(5)
  }

  async function createSubscription(value: { title: string; feedUrl: string }): Promise<void> {
    const feed = await addFeed({ kind: 'arxiv', ...value })
    scope = `feed:${feed.id}`
    if (feed.errorMessage) showToast(feed.errorMessage, 'error')
    else showToast('arXiv 订阅已添加', 'success')
  }

  async function editSubscription(value: { title: string; feedUrl: string; folder?: string }): Promise<void> {
    if (!editing) return
    await updateFeed(editing.id, { title: value.title || editing.title, folder: value.folder })
    showToast('订阅信息已保存', 'success')
  }

  function refreshFeed(feedId: string): void {
    void refreshOneFeed(feedId)
      .then((ok) => {
        const feed = appState.feeds.find((item) => item.id === feedId)
        showToast(ok ? '订阅已刷新' : feed?.errorMessage || 'arXiv 刷新失败', ok ? 'success' : 'error')
      })
      .catch((error) => showToast(`arXiv 刷新失败：${String(error)}`, 'error'))
  }

  function refreshAll(): void {
    void refreshAllFeeds('arxiv')
      .then(({ success, failed }) => {
        if (failed) showToast(`刷新完成：${success} 个成功，${failed} 个失败`, 'error')
        else showToast(success ? `已刷新 ${success} 个订阅` : '没有可刷新的订阅', 'success')
      })
      .catch((error) => showToast(`arXiv 刷新失败：${String(error)}`, 'error'))
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
</script>

<div class="arxiv-page">
  <FeedSidebar
    kind="arxiv"
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
  />
  <EntryList kind="arxiv" {scope} />
  <EntryReader kind="arxiv" />
</div>

{#if showAdd}
  <AddArxivDialog onclose={() => (showAdd = false)} onsubmit={createSubscription} />
{/if}
{#if editing}
  <AddFeedDialog feed={editing} onclose={() => (editing = null)} onsubmit={editSubscription} />
{/if}
{#if deleting}
  <Modal title="删除 arXiv 订阅" onclose={() => (deleting = null)}>
    <div class="confirm">
      <Trash2 />
      <p>删除“{deleting.title}”及其本地论文记录？此操作无法撤销。</p>
      {#if deleteError}<p class="delete-error" role="alert">{deleteError}</p>{/if}
      <footer>
        <button class="secondary" onclick={() => (deleting = null)} disabled={deleteLoading}>取消</button>
        <button class="danger" onclick={() => void confirmDelete()} disabled={deleteLoading}>{deleteLoading ? '删除中…' : '删除'}</button>
      </footer>
    </div>
  </Modal>
{/if}

<style>
  .arxiv-page { min-height: 0; flex: 1; display: flex; overflow: hidden; }
  .confirm { display: grid; justify-items: center; gap: 13px; text-align: center; }
  .confirm > :global(svg) { width: 26px; height: 26px; color: var(--danger); }
  .confirm p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
  .confirm .delete-error { color: var(--danger); font-size: 11px; }
  footer { display: flex; gap: 8px; margin-top: 7px; }
</style>
