<script lang="ts">
  import { Database, LoaderCircle } from '@lucide/svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { onMount } from 'svelte'
  import { flushPersistence, hydrateAppState } from './app/persistence'
  import { appState, showToast } from './app/state.svelte'
  import AppHeader from './components/AppHeader.svelte'
  import SettingsDialog from './components/SettingsDialog.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Toast from './components/Toast.svelte'
  import ArxivPage from './features/arxiv/ArxivPage.svelte'
  import DeadlinePage from './features/deadlines/DeadlinePage.svelte'
  import FeedPage from './features/feeds/FeedPage.svelte'
  import { refreshAllFeeds } from './features/feeds/feedState.svelte'
  import ZoteroPage from './features/zotero/ZoteroPage.svelte'

  let showSettings = $state(false)

  $effect(() => {
    document.documentElement.dataset.theme = appState.settings.theme
  })

  $effect(() => {
    if (!appState.initialized) return
    const delay = Math.max(1, appState.settings.refreshIntervalMinutes) * 60_000
    const timer = window.setInterval(() => {
      void refreshAllFeeds()
        .then(({ failed }) => {
          if (failed) showToast(`定时刷新有 ${failed} 个订阅失败`, 'error')
        })
        .catch((error) => showToast(`定时刷新失败：${String(error)}`, 'error'))
    }, delay)
    return () => window.clearInterval(timer)
  })

  onMount(() => {
    let unlisten: (() => void) | undefined
    let closing = false

    const hydration = hydrateAppState()
    void hydration
      .then(() => {
        if (!appState.feeds.length) return
        void refreshAllFeeds()
          .then(({ failed }) => {
            if (failed) showToast(`启动刷新有 ${failed} 个订阅失败`, 'error')
          })
          .catch((error) => showToast(`启动刷新失败：${String(error)}`, 'error'))
      })
      .catch((error) => showToast(`初始化失败：${String(error)}`, 'error'))

    const flushBeforeUnload = (): void => {
      void flushPersistence().catch(() => undefined)
    }
    window.addEventListener('beforeunload', flushBeforeUnload)

    const appWindow = getCurrentWindow()
    void appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault()
        if (closing) return
        closing = true
        try {
          await hydration
          await flushPersistence()
          await appWindow.destroy()
        } catch (error) {
          closing = false
          showToast(`保存本地数据失败，窗口保持打开：${String(error)}`, 'error')
        }
      })
      .then((stopListening) => {
        unlisten = stopListening
      })
      .catch(() => undefined)

    return () => {
      window.removeEventListener('beforeunload', flushBeforeUnload)
      unlisten?.()
    }
  })
</script>

<div class="app-shell">
  <Sidebar onsettings={() => (showSettings = true)} />
  <main>
    <AppHeader />
    {#if !appState.initialized}
      <div class="startup-state">
        <LoaderCircle class="spinning" />
        <strong>正在读取本地工作台</strong>
      </div>
    {:else}
      {#if appState.startupError}
        <div class="startup-error" role="alert"><Database />{appState.startupError}</div>
      {/if}
      {#if appState.currentView === 'feeds'}
        <FeedPage />
      {:else if appState.currentView === 'arxiv'}
        <ArxivPage />
      {:else if appState.currentView === 'deadlines'}
        <DeadlinePage />
      {:else}
        <ZoteroPage />
      {/if}
    {/if}
  </main>
</div>

{#if showSettings}<SettingsDialog onclose={() => (showSettings = false)} />{/if}
<Toast />

<style>
  .app-shell { width: 100%; height: 100vh; display: flex; overflow: hidden; }
  main { min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .startup-state { flex: 1; display: grid; align-content: center; justify-items: center; gap: 10px; color: var(--text-subtle); }
  .startup-state :global(svg) { width: 24px; height: 24px; }
  .startup-state strong { color: var(--text-muted); font-size: 12px; font-weight: 550; }
  .startup-error { min-height: 37px; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 0 15px; color: var(--danger); background: var(--danger-soft); border-bottom: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border)); font-size: 11px; }
  .startup-error :global(svg) { width: 14px; height: 14px; }
  :global(.spinning) { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
