<script lang="ts">
  import { Columns2, Eye, FilePenLine } from '@lucide/svelte'
  import { onDestroy, untrack } from 'svelte'
  import NoteEditor from './NoteEditor.svelte'
  import NotePreview from './NotePreview.svelte'
  import { createNoteState } from './noteState.svelte'

  interface Props {
    itemKey: string
    title: string
  }

  type NoteMode = 'edit' | 'split' | 'preview'

  let { itemKey, title }: Props = $props()
  let mode = $state<NoteMode>('split')
  const note = createNoteState('', '')

  let saveLabel = $derived(
    note.saveState === 'dirty'
      ? '等待保存'
      : note.saveState === 'saving'
        ? '正在保存'
        : note.saveState === 'saved'
          ? '已保存'
          : note.saveState === 'error'
            ? '保存失败'
            : '未修改',
  )

  $effect.pre(() => {
    const nextItemKey = itemKey
    const nextTitle = title
    untrack(() => note.switchItem(nextItemKey, nextTitle))
  })

  onDestroy(() => note.destroy())
</script>

<section class="note-panel" aria-label={`${title}的笔记`}>
  <header class="note-header">
    <div class="note-identity">
      <FilePenLine aria-hidden="true" />
      <h2 title={title}>{title || '未命名文献'}</h2>
    </div>

    <div class="mode-switcher" role="tablist" aria-label="笔记视图">
      <button
        type="button"
        role="tab"
        aria-label="编辑"
        aria-selected={mode === 'edit'}
        title="编辑"
        class:active={mode === 'edit'}
        onclick={() => (mode = 'edit')}
      >
        <FilePenLine /><span>编辑</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-label="分栏"
        aria-selected={mode === 'split'}
        title="分栏"
        class:active={mode === 'split'}
        onclick={() => (mode = 'split')}
      >
        <Columns2 /><span>分栏</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-label="预览"
        aria-selected={mode === 'preview'}
        title="预览"
        class:active={mode === 'preview'}
        onclick={() => (mode = 'preview')}
      >
        <Eye /><span>预览</span>
      </button>
    </div>

    <span
      class="save-state"
      class:error={note.saveState === 'error'}
      title={note.saveError || saveLabel}
      role={note.saveState === 'error' ? 'alert' : 'status'}
    >{saveLabel}</span>
  </header>

  <div class="note-workspace" class:split={mode === 'split'} data-mode={mode}>
    {#key note.itemKey}
      {#if mode !== 'preview'}
        <div class="editor-pane" role="tabpanel" aria-label="编辑笔记">
          <NoteEditor value={note.markdown} onchange={(value) => note.setMarkdown(value)} />
        </div>
      {/if}
      {#if mode !== 'edit'}
        <div class="preview-pane" role="tabpanel" aria-label="预览笔记">
          <NotePreview markdown={note.markdown} />
        </div>
      {/if}
    {/key}
  </div>
</section>

<style>
  .note-panel {
    min-width: 0;
    min-height: 420px;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text-primary, var(--text-h, #18181b));
    background: var(--surface-raised, var(--bg, #fff));
    text-align: left;
    container-type: inline-size;
  }

  .note-header {
    min-height: 48px;
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: minmax(120px, 1fr) auto minmax(64px, 1fr);
    align-items: center;
    gap: 14px;
    box-sizing: border-box;
    padding: 7px 12px 7px 16px;
    border-bottom: 1px solid var(--border, #e4e4e7);
  }

  .note-identity {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .note-identity :global(svg) {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    color: var(--accent, #7c3aed);
  }

  h2 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: inherit;
    font: 650 13px/1.3 var(--font-sans, var(--sans, system-ui, sans-serif));
    letter-spacing: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mode-switcher {
    display: grid;
    grid-template-columns: repeat(3, minmax(66px, 1fr));
    align-items: center;
    padding: 2px;
    background: var(--surface-muted, var(--code-bg, #f4f4f5));
    border: 1px solid var(--border, #e4e4e7);
    border-radius: 6px;
  }

  .mode-switcher button {
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 9px;
    color: var(--text-muted, var(--text, #52525b));
    background: transparent;
    border: 0;
    border-radius: 4px;
    font: 600 11px/1 var(--font-sans, var(--sans, system-ui, sans-serif));
    cursor: pointer;
  }

  .mode-switcher button:hover {
    color: var(--text-primary, var(--text-h, #18181b));
  }

  .mode-switcher button.active {
    color: var(--text-primary, var(--text-h, #18181b));
    background: var(--surface-raised, var(--bg, #fff));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .mode-switcher button:focus-visible {
    outline: 2px solid var(--accent, #7c3aed);
    outline-offset: 1px;
  }

  .mode-switcher button :global(svg) {
    width: 13px;
    height: 13px;
    flex: 0 0 13px;
  }

  .save-state {
    justify-self: end;
    color: var(--text-subtle, var(--text, #71717a));
    font: 500 10px/1.2 var(--font-sans, var(--sans, system-ui, sans-serif));
    white-space: nowrap;
  }

  .save-state.error {
    color: var(--danger, #b42318);
  }

  .note-workspace {
    min-width: 0;
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    overflow: hidden;
  }

  .note-workspace.split {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .editor-pane,
  .preview-pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .note-workspace.split .editor-pane {
    border-right: 1px solid var(--border, #e4e4e7);
  }

  @container (max-width: 560px) {
    .note-header {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      padding-left: 12px;
    }

    .note-identity {
      grid-column: 1;
    }

    .mode-switcher {
      grid-column: 2;
      grid-template-columns: repeat(3, 32px);
    }

    .mode-switcher button {
      width: 32px;
      padding: 0;
    }

    .mode-switcher span {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .save-state {
      display: none;
    }

    .note-workspace.split {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(240px, 1fr) minmax(240px, 1fr);
      overflow: auto;
    }

    .note-workspace.split .editor-pane {
      border-right: 0;
      border-bottom: 1px solid var(--border, #e4e4e7);
    }
  }
</style>
