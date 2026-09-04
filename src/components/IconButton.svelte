<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    children: Snippet
    onclick?: (event: MouseEvent) => void
    disabled?: boolean
    active?: boolean
    type?: 'button' | 'submit'
  }

  let {
    label,
    children,
    onclick,
    disabled = false,
    active = false,
    type = 'button',
  }: Props = $props()
</script>

<button {type} class:active {disabled} {onclick} aria-label={label} title={label}>
  {@render children()}
</button>

<style>
  button {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    cursor: pointer;
  }

  button:hover:not(:disabled),
  button.active {
    color: var(--text-primary);
    background: var(--surface-hover);
    border-color: var(--border);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  button :global(svg) {
    width: 17px;
    height: 17px;
  }
</style>
