<script lang="ts">
  import { appState } from '../app/state.svelte'

  const headings = {
    feeds: ['RSS Reader', '订阅与阅读'],
    arxiv: ['arXiv', '论文订阅'],
    deadlines: ['DDL', '会议与期刊截稿'],
    zotero: ['Zotero', '本机文献与笔记'],
  } as const

  let heading = $derived(headings[appState.currentView])
</script>

<header>
  <div>
    <h1>{heading[0]}</h1>
    <span>{heading[1]}</span>
  </div>
  <div class="local"><i></i> 本地优先</div>
</header>

<style>
  header {
    height: 54px;
    flex: 0 0 54px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 18px 0 20px;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-strong);
  }

  header > div:first-child {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 680;
  }

  span,
  .local {
    color: var(--text-subtle);
    font-size: 11px;
  }

  .local {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  i {
    width: 6px;
    height: 6px;
    background: var(--success);
    border-radius: 50%;
  }
</style>
