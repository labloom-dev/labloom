<script lang="ts">
  import { onMount } from 'svelte'
  import type { MarkdownEditor } from './editor'

  interface Props {
    value: string
    onchange: (value: string) => void
    ariaLabel?: string
    autofocus?: boolean
  }

  let {
    value,
    onchange,
    ariaLabel = 'Markdown 笔记编辑器',
    autofocus = false,
  }: Props = $props()

  let host = $state<HTMLDivElement | null>(null)
  let editor = $state<MarkdownEditor | null>(null)
  let loading = $state(true)
  let error = $state('')

  onMount(() => {
    let disposed = false

    async function mountEditor(): Promise<void> {
      try {
        const { createMarkdownEditor } = await import('./editor')
        if (disposed) return
        if (!host) throw new Error('Editor mount point is unavailable')

        const instance = await createMarkdownEditor({
          parent: host,
          value,
          ariaLabel,
          autofocus,
          onChange: (nextValue) => onchange(nextValue),
        })
        if (disposed) {
          instance.destroy()
          return
        }

        editor = instance
        editor.setValue(value)
      } catch (reason) {
        if (!disposed) error = reason instanceof Error ? reason.message : String(reason)
      } finally {
        if (!disposed) loading = false
      }
    }

    void mountEditor()

    return () => {
      disposed = true
      editor?.destroy()
      editor = null
    }
  })

  $effect(() => {
    editor?.setValue(value)
  })
</script>

<div class="note-editor" aria-busy={loading}>
  {#if error}
    <div class="editor-error" role="alert">
      <p>编辑器加载失败，已切换到基础编辑模式。</p>
      <span>{error}</span>
    </div>
    <textarea
      value={value}
      aria-label={ariaLabel}
      spellcheck="false"
      oninput={(event) => onchange(event.currentTarget.value)}
    ></textarea>
  {:else}
    <div class="editor-host" bind:this={host}></div>
    {#if loading}<div class="loading">正在加载编辑器...</div>{/if}
  {/if}
</div>

<style>
  .note-editor {
    position: relative;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    color: var(--text-primary, var(--text-h, #18181b));
    background: var(--surface-raised, var(--bg, #fff));
  }

  .editor-host {
    height: 100%;
  }

  .editor-host :global(.cm-editor) {
    height: 100%;
    color: inherit;
    background: transparent;
    font: 13px/1.65 var(--font-mono, var(--mono, ui-monospace, monospace));
  }

  .editor-host :global(.cm-scroller) {
    overflow: auto;
    font-family: inherit;
  }

  .editor-host :global(.cm-content) {
    min-height: 100%;
    padding: 20px clamp(16px, 2vw, 26px) 48px;
    caret-color: var(--accent, #7c3aed);
  }

  .editor-host :global(.cm-line) {
    padding: 0;
  }

  .editor-host :global(.cm-focused) {
    outline: none;
  }

  .editor-host :global(.cm-selectionBackground),
  .editor-host :global(.cm-content ::selection) {
    background: var(--accent-bg, rgba(124, 58, 237, 0.16)) !important;
  }

  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-subtle, var(--text, #71717a));
    background: inherit;
    font-size: 12px;
  }

  .editor-error {
    padding: 12px 16px;
    color: var(--danger, #b42318);
    background: color-mix(in srgb, var(--danger, #b42318) 8%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--danger, #b42318) 25%, transparent);
    font-size: 12px;
    line-height: 1.45;
  }

  .editor-error p {
    margin: 0 0 3px;
    color: inherit;
    font-weight: 650;
  }

  .editor-error span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  textarea {
    width: 100%;
    height: calc(100% - 68px);
    min-height: 240px;
    box-sizing: border-box;
    resize: none;
    padding: 20px clamp(16px, 2vw, 26px) 48px;
    color: inherit;
    background: transparent;
    border: 0;
    outline: 0;
    font: 13px/1.65 var(--font-mono, var(--mono, ui-monospace, monospace));
  }
</style>
