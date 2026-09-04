<script lang="ts">
  import { CalendarDays, Library, Rss, Settings, Sigma } from '@lucide/svelte'
  import { appState } from '../app/state.svelte'
  import type { AppView } from '../types'

  interface Props {
    onsettings: () => void
  }

  let { onsettings }: Props = $props()

  const items: Array<{ view: AppView; label: string; icon: typeof Rss }> = [
    { view: 'feeds', label: 'RSS', icon: Rss },
    { view: 'arxiv', label: 'arXiv', icon: Sigma },
    { view: 'deadlines', label: 'DDL', icon: CalendarDays },
    { view: 'zotero', label: 'Zotero', icon: Library },
  ]
</script>

<aside aria-label="主导航">
  <div class="brand" title="Research Desk">RD</div>
  <nav>
    {#each items as item}
      <button
        class:active={appState.currentView === item.view}
        onclick={() => (appState.currentView = item.view)}
        aria-label={item.label}
        title={item.label}
      >
        <item.icon />
        <span>{item.label}</span>
      </button>
    {/each}
  </nav>
  <button class="settings" onclick={onsettings} aria-label="设置" title="设置">
    <Settings />
  </button>
</aside>

<style>
  aside {
    width: 72px;
    min-width: 72px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: var(--nav-bg);
    border-right: 1px solid var(--border-strong);
    user-select: none;
  }

  .brand {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    margin: 14px 0 19px;
    color: #fff;
    background: var(--accent-strong);
    border-radius: 6px;
    font: 700 12px/1 var(--font-mono);
  }

  nav {
    width: 100%;
    display: grid;
    gap: 4px;
  }

  button {
    width: 100%;
    height: 53px;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    padding: 0;
    color: var(--text-subtle);
    background: transparent;
    border: 0;
    border-left: 2px solid transparent;
    cursor: pointer;
  }

  button:hover,
  button.active {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  button.active {
    border-left-color: var(--accent);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }

  button :global(svg) {
    width: 18px;
    height: 18px;
  }

  span {
    font-size: 10px;
    line-height: 1;
  }

  .settings {
    height: 48px;
    margin-top: auto;
    border-top: 1px solid var(--border);
  }
</style>
