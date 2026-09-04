<script lang="ts">
  import {
    CalendarDays,
    CircleAlert,
    Download,
    List,
    LoaderCircle,
    Plus,
    RefreshCw,
    Trash2,
    Upload,
    X,
  } from '@lucide/svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { persistSettings } from '../../app/persistence'
  import { appState, showToast } from '../../app/state.svelte'
  import IconButton from '../../components/IconButton.svelte'
  import Modal from '../../components/Modal.svelte'
  import { chooseTextFile, saveTextFile } from '../../lib/files'
  import type { Deadline } from '../../types'
  import { exportDeadlineCsv, importDeadlineCsv } from './csv'
  import DeadlineCalendar from './DeadlineCalendar.svelte'
  import DeadlineForm from './DeadlineForm.svelte'
  import DeadlineList from './DeadlineList.svelte'
  import {
    addDeadline,
    appendImportedDeadlines,
    deleteDeadline,
    fetchCcfDeadlines,
    normalizeHttpUrl,
    sortDeadlines,
    updateDeadline,
    type DeadlineDraft,
    type DeadlineImportIssue,
  } from './deadline'

  type ViewMode = 'list' | 'calendar'

  interface ImportSummary {
    title: string
    added: number
    skipped: number
    issues: DeadlineImportIssue[]
  }

  let view = $state<ViewMode>('list')
  let showForm = $state(false)
  let editing = $state<Deadline | null>(null)
  let deleting = $state<Deadline | null>(null)
  let deleteLoading = $state(false)
  let deleteError = $state('')
  let importingCsv = $state(false)
  let exportingCsv = $state(false)
  let importingCcf = $state(false)
  let openingId = $state<string | null>(null)
  let actionError = $state('')
  let importSummary = $state<ImportSummary | null>(null)
  let showCcfSetup = $state(false)
  let ccfUrl = $state('')
  let ccfSetupLoading = $state(false)
  let ccfSetupError = $state('')
  let sortedDeadlines = $derived(sortDeadlines(appState.deadlines))

  function openAddForm(): void {
    editing = null
    showForm = true
  }

  function openEditForm(deadline: Deadline): void {
    editing = deadline
    showForm = true
  }

  function editById(id: string): void {
    const deadline = appState.deadlines.find((item) => item.id === id)
    if (deadline) openEditForm(deadline)
  }

  async function saveDeadline(value: DeadlineDraft): Promise<void> {
    actionError = ''
    if (editing) {
      await updateDeadline(editing.id, value)
      showToast('截止日期已更新', 'success')
    } else {
      await addDeadline(value)
      showToast('截止日期已添加', 'success')
    }
  }

  function requestDelete(deadline: Deadline): void {
    deleteError = ''
    deleting = deadline
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting || deleteLoading) return
    deleteLoading = true
    deleteError = ''
    try {
      const title = deleting.title
      await deleteDeadline(deleting.id)
      deleting = null
      showToast(`已删除“${title}”`, 'success')
    } catch (error) {
      deleteError = error instanceof Error ? error.message : String(error)
    } finally {
      deleteLoading = false
    }
  }

  async function openOfficialLink(deadline: Deadline): Promise<void> {
    if (!deadline.url || openingId) return
    openingId = deadline.id
    actionError = ''
    try {
      await openUrl(deadline.url)
    } catch (error) {
      actionError = `无法打开官方链接：${error instanceof Error ? error.message : String(error)}`
    } finally {
      openingId = null
    }
  }

  async function importCsv(): Promise<void> {
    if (importingCsv) return
    importingCsv = true
    actionError = ''
    try {
      const source = await chooseTextFile({ title: '导入截止日期 CSV', extensions: ['csv'] })
      if (source === null) return
      const parsed = importDeadlineCsv(source, appState.deadlines)
      const merged = await appendImportedDeadlines(parsed.deadlines)
      importSummary = {
        title: 'CSV 导入结果',
        added: merged.added,
        skipped: parsed.skipped + merged.skipped,
        issues: parsed.issues,
      }
    } catch (error) {
      importSummary = {
        title: 'CSV 导入结果',
        added: 0,
        skipped: 0,
        issues: [{ message: error instanceof Error ? error.message : String(error) }],
      }
    } finally {
      importingCsv = false
    }
  }

  async function exportCsv(): Promise<void> {
    if (exportingCsv) return
    exportingCsv = true
    actionError = ''
    try {
      const saved = await saveTextFile(exportDeadlineCsv(sortedDeadlines), {
        title: '导出截止日期 CSV',
        defaultPath: 'research-desk-deadlines.csv',
        extensions: ['csv'],
      })
      if (saved) showToast('截止日期 CSV 已导出', 'success')
    } catch (error) {
      actionError = `CSV 导出失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      exportingCsv = false
    }
  }

  function beginCcfImport(): void {
    if (importingCcf) return
    const configuredUrl = appState.settings.ccfFeedUrl.trim()
    if (!configuredUrl) {
      ccfUrl = ''
      ccfSetupError = ''
      showCcfSetup = true
      return
    }
    void importCcf(configuredUrl)
  }

  async function saveCcfFeedUrl(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    ccfSetupError = ''
    ccfSetupLoading = true
    const previousSettings = appState.settings
    try {
      const url = normalizeHttpUrl(ccfUrl.trim())
      appState.settings = { ...appState.settings, ccfFeedUrl: url }
      await persistSettings()
      showCcfSetup = false
      await importCcf(url)
    } catch (error) {
      appState.settings = previousSettings
      ccfSetupError = error instanceof Error ? error.message : String(error)
    } finally {
      ccfSetupLoading = false
    }
  }

  async function importCcf(feedUrl: string): Promise<void> {
    if (importingCcf) return
    importingCcf = true
    actionError = ''
    try {
      const parsed = await fetchCcfDeadlines(feedUrl, appState.deadlines)
      const merged = await appendImportedDeadlines(parsed.deadlines)
      importSummary = {
        title: 'CCF RSS 导入结果',
        added: merged.added,
        skipped: parsed.skipped + merged.skipped,
        issues: parsed.issues,
      }
    } catch (error) {
      importSummary = {
        title: 'CCF RSS 导入结果',
        added: 0,
        skipped: 0,
        issues: [{ message: error instanceof Error ? error.message : String(error) }],
      }
    } finally {
      importingCcf = false
    }
  }
</script>

<div class="deadline-page" aria-busy={importingCsv || exportingCsv || importingCcf}>
  <div class="toolbar">
    <div class="segmented" aria-label="显示方式">
      <button class:active={view === 'list'} onclick={() => (view = 'list')} aria-pressed={view === 'list'}>
        <List />列表
      </button>
      <button class:active={view === 'calendar'} onclick={() => (view = 'calendar')} aria-pressed={view === 'calendar'}>
        <CalendarDays />日历
      </button>
    </div>

    <span class="count">{sortedDeadlines.length} 个记录</span>

    <div class="toolbar-actions">
      <button class="secondary" onclick={beginCcfImport} disabled={importingCcf} title="从 CCF RSS 导入">
        {#if importingCcf}<LoaderCircle class="spinning" />{:else}<RefreshCw />{/if}
        <span>{importingCcf ? '导入中…' : 'CCF RSS'}</span>
      </button>
      <button class="secondary" onclick={() => void importCsv()} disabled={importingCsv}>
        {#if importingCsv}<LoaderCircle class="spinning" />{:else}<Upload />{/if}
        <span>{importingCsv ? '导入中…' : '导入 CSV'}</span>
      </button>
      <button class="secondary" onclick={() => void exportCsv()} disabled={exportingCsv || !sortedDeadlines.length}>
        {#if exportingCsv}<LoaderCircle class="spinning" />{:else}<Download />{/if}
        <span>{exportingCsv ? '导出中…' : '导出 CSV'}</span>
      </button>
      <button class="primary" onclick={openAddForm}><Plus /><span>添加</span></button>
    </div>
  </div>

  {#if actionError}
    <div class="action-error" role="alert">
      <CircleAlert /><span>{actionError}</span>
      <IconButton label="关闭错误" onclick={() => (actionError = '')}><X /></IconButton>
    </div>
  {/if}

  {#if view === 'list'}
    <DeadlineList
      deadlines={sortedDeadlines}
      {openingId}
      onedit={openEditForm}
      ondelete={requestDelete}
      onopen={(deadline) => void openOfficialLink(deadline)}
    />
  {:else}
    <DeadlineCalendar deadlines={sortedDeadlines} onedit={editById} />
  {/if}
</div>

{#if showForm}
  <DeadlineForm
    deadline={editing ?? undefined}
    onclose={() => {
      showForm = false
      editing = null
    }}
    onsubmit={saveDeadline}
  />
{/if}

{#if deleting}
  <Modal title="删除截止日期" onclose={() => !deleteLoading && (deleting = null)}>
    <div class="confirm">
      <Trash2 />
      <p>删除“{deleting.title}”？此操作无法撤销。</p>
      {#if deleteError}<p class="modal-error" role="alert">{deleteError}</p>{/if}
      <footer>
        <button class="secondary" onclick={() => (deleting = null)} disabled={deleteLoading}>取消</button>
        <button class="danger" onclick={() => void confirmDelete()} disabled={deleteLoading}>
          {deleteLoading ? '删除中…' : '删除'}
        </button>
      </footer>
    </div>
  </Modal>
{/if}

{#if showCcfSetup}
  <Modal title="设置 CCF RSS" onclose={() => !ccfSetupLoading && (showCcfSetup = false)} width="520px">
    <form class="ccf-form" onsubmit={saveCcfFeedUrl} aria-busy={ccfSetupLoading}>
      <label>
        <span>Feed URL</span>
        <input bind:value={ccfUrl} type="url" required placeholder="https://example.org/ccf-deadlines.xml" />
      </label>
      {#if ccfSetupError}<p class="modal-error" role="alert">{ccfSetupError}</p>{/if}
      <footer>
        <button type="button" class="secondary" onclick={() => (showCcfSetup = false)} disabled={ccfSetupLoading}>取消</button>
        <button type="submit" class="primary" disabled={ccfSetupLoading}>{ccfSetupLoading ? '保存中…' : '保存并导入'}</button>
      </footer>
    </form>
  </Modal>
{/if}

{#if importSummary}
  <Modal title={importSummary.title} onclose={() => (importSummary = null)} width="600px">
    <div class="import-result">
      <div class="result-counts">
        <div><strong>{importSummary.added}</strong><span>新增</span></div>
        <div><strong>{importSummary.skipped}</strong><span>重复跳过</span></div>
        <div class:error-count={importSummary.issues.length > 0}><strong>{importSummary.issues.length}</strong><span>问题</span></div>
      </div>
      {#if importSummary.issues.length}
        <div class="issues" role="status">
          {#each importSummary.issues as issue, index (`${issue.row ?? 0}-${index}`)}
            <div>
              <CircleAlert />
              <p>
                <strong>{issue.row ? `记录 ${issue.row}` : '导入错误'}{issue.title ? ` · ${issue.title}` : ''}</strong>
                <span>{issue.message}</span>
              </p>
            </div>
          {/each}
        </div>
      {:else}
        <p class="result-ok">所有可用记录均已处理。</p>
      {/if}
      <footer><button class="primary" onclick={() => (importSummary = null)}>关闭</button></footer>
    </div>
  </Modal>
{/if}

<style>
  .deadline-page { min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--surface-raised); }
  .toolbar { min-height: 50px; flex: 0 0 auto; display: flex; align-items: center; gap: 12px; padding: 0 14px 0 18px; background: var(--surface-muted); border-bottom: 1px solid var(--border); }
  .segmented { height: 30px; display: inline-flex; padding: 2px; background: var(--surface-hover); border: 1px solid var(--border); border-radius: 6px; }
  .segmented button { min-width: 72px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 9px; color: var(--text-subtle); background: transparent; border: 0; border-radius: 4px; font-size: 11px; cursor: pointer; }
  .segmented button.active { color: var(--text-primary); background: var(--surface-raised); box-shadow: 0 1px 2px rgb(0 0 0 / 8%); }
  .segmented button :global(svg), .toolbar-actions button :global(svg) { width: 14px; height: 14px; }
  .count { color: var(--text-subtle); font-size: 10px; white-space: nowrap; }
  .toolbar-actions { min-width: 0; display: flex; align-items: center; gap: 7px; margin-left: auto; }
  .toolbar-actions > button { height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 9px; white-space: nowrap; }
  .action-error { min-height: 38px; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 3px 8px 3px 16px; color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--surface-raised)); border-bottom: 1px solid color-mix(in srgb, var(--danger) 25%, var(--border)); font-size: 11px; }
  .action-error > :global(svg) { width: 15px; height: 15px; flex: 0 0 auto; }
  .action-error span { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .confirm { display: grid; justify-items: center; gap: 13px; text-align: center; }
  .confirm > :global(svg) { width: 26px; height: 26px; color: var(--danger); }
  .confirm p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 7px; }
  .modal-error { margin: 0; color: var(--danger) !important; font-size: 12px !important; }
  .ccf-form { display: grid; gap: 15px; }
  .ccf-form label { display: grid; gap: 6px; }
  .ccf-form label span { color: var(--text-muted); font-size: 12px; font-weight: 550; }
  .ccf-form input { width: 100%; box-sizing: border-box; }
  .import-result { display: grid; gap: 16px; }
  .result-counts { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .result-counts > div { min-width: 0; display: grid; justify-items: center; gap: 3px; padding: 12px; border-right: 1px solid var(--border); }
  .result-counts > div:last-child { border-right: 0; }
  .result-counts strong { color: var(--text-primary); font: 650 18px/1 var(--font-mono); }
  .result-counts span { color: var(--text-subtle); font-size: 10px; }
  .result-counts .error-count strong { color: var(--danger); }
  .issues { max-height: 270px; overflow: auto; border: 1px solid var(--border); }
  .issues > div { display: flex; gap: 9px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .issues > div:last-child { border-bottom: 0; }
  .issues :global(svg) { width: 15px; height: 15px; flex: 0 0 auto; margin-top: 1px; color: var(--danger); }
  .issues p { min-width: 0; display: grid; gap: 3px; margin: 0; }
  .issues strong { color: var(--text-primary); font-size: 11px; font-weight: 620; overflow-wrap: anywhere; }
  .issues span, .result-ok { color: var(--text-muted); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
  .result-ok { margin: 2px 0; text-align: center; }
  :global(.spinning) { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 840px) {
    .toolbar { align-items: flex-start; flex-wrap: wrap; padding-top: 9px; padding-bottom: 9px; }
    .toolbar-actions { width: 100%; order: 3; margin-left: 0; overflow-x: auto; }
    .count { margin-left: auto; align-self: center; }
  }
  @media (max-width: 520px) {
    .toolbar-actions > button span { display: none; }
    .toolbar-actions > button { width: 32px; padding: 0; }
    .toolbar-actions > button:last-child { width: auto; padding: 0 10px; }
    .toolbar-actions > button:last-child span { display: inline; }
  }
</style>
