<script lang="ts">
  import type { Component } from 'svelte'

  interface Props {
    icon: Component<{ size?: number; strokeWidth?: number }>
    title: string
    description?: string
  }

  let { icon: Icon, title, description }: Props = $props()
</script>

<div class="empty-state">
  <Icon size={28} strokeWidth={1.5} />
  <strong>{title}</strong>
  {#if description}<p>{description}</p>{/if}
</div>

<style>
  .empty-state {
    min-height: 220px;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 9px;
    padding: 28px;
    text-align: center;
    color: var(--text-muted);
  }

  strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
  }

  p {
    max-width: 360px;
    margin: 0;
    color: var(--text-subtle);
    font-size: 12px;
    line-height: 1.55;
  }
</style>
