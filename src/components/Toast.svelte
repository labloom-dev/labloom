<script lang="ts">
  import { CircleAlert, CircleCheck, Info, X } from '@lucide/svelte'
  import { appState, clearToast } from '../app/state.svelte'
</script>

{#if appState.toast}
  <div class="toast" class:error={appState.toast.kind === 'error'} class:success={appState.toast.kind === 'success'} role="status">
    {#if appState.toast.kind === 'error'}
      <CircleAlert />
    {:else if appState.toast.kind === 'success'}
      <CircleCheck />
    {:else}
      <Info />
    {/if}
    <span>{appState.toast.message}</span>
    <button onclick={clearToast} aria-label="关闭消息"><X /></button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    z-index: 150;
    right: 18px;
    bottom: 18px;
    max-width: 420px;
    min-height: 40px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 8px 7px 12px;
    color: var(--text-primary);
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    box-shadow: 0 8px 22px rgb(0 0 0 / 14%);
    font-size: 12px;
  }

  .toast.error { border-left-color: var(--danger); }
  .toast.success { border-left-color: var(--success); }
  .toast > :global(svg) { width: 16px; height: 16px; flex: 0 0 auto; }
  .toast span { flex: 1; }
  button { width: 26px; height: 26px; display: grid; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; cursor: pointer; }
  button :global(svg) { width: 14px; height: 14px; }
</style>
