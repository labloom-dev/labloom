<script lang="ts">
  import { CircleAlert, FileText, LoaderCircle, RefreshCw } from '@lucide/svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { onDestroy } from 'svelte'
  import { showToast } from '../../app/state.svelte'
  import { debounce } from '../../lib/debounce'

  interface Props {
    markdown: string
  }

  let { markdown }: Props = $props()

  let html = $state('')
  let error = $state('')
  let status = $state<'empty' | 'loading' | 'ready' | 'error'>('empty')
  let requestId = 0
  let destroyed = false
  let mathStyleElement: HTMLStyleElement | null = null

  function setMathStyles(styles: string): void {
    if (!styles) {
      mathStyleElement?.remove()
      mathStyleElement = null
      return
    }

    mathStyleElement ??= document.head.appendChild(document.createElement('style'))
    mathStyleElement.dataset.noteMathjax = ''
    mathStyleElement.textContent = styles
  }

  async function render(source: string, id: number): Promise<void> {
    try {
      const { renderMarkdown } = await import('./markdown')
      const result = await renderMarkdown(source)
      if (destroyed || id !== requestId) return

      html = result.html
      setMathStyles(result.styles)
      error = result.error
      status = result.error ? 'error' : 'ready'
    } catch (reason) {
      if (destroyed || id !== requestId) return
      html = ''
      setMathStyles('')
      error = reason instanceof Error ? reason.message : String(reason)
      status = 'error'
    }
  }

  const queueRender = debounce((source: string, id: number) => {
    void render(source, id)
  }, 250)

  function schedule(source: string): void {
    const id = ++requestId
    queueRender.cancel()

    if (!source.trim()) {
      html = ''
      setMathStyles('')
      error = ''
      status = 'empty'
      return
    }

    status = 'loading'
    error = ''
    queueRender(source, id)
  }

  function retry(): void {
    const id = ++requestId
    queueRender.cancel()
    status = 'loading'
    error = ''
    void render(markdown, id)
  }

  function openPreviewLink(event: MouseEvent): void {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    try {
      const url = new URL(href)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 链接')
      void openUrl(url).catch((reason) => showToast(`无法打开链接：${String(reason)}`, 'error'))
    } catch (reason) {
      showToast(`无法打开链接：${reason instanceof Error ? reason.message : String(reason)}`, 'error')
    }
  }

  function routePreviewLinks(node: HTMLElement): { destroy: () => void } {
    node.addEventListener('click', openPreviewLink)
    return { destroy: () => node.removeEventListener('click', openPreviewLink) }
  }

  $effect(() => {
    schedule(markdown)
  })

  onDestroy(() => {
    destroyed = true
    requestId += 1
    queueRender.cancel()
    setMathStyles('')
  })
</script>

<div class="note-preview" aria-busy={status === 'loading'}>
  {#if status === 'empty'}
    <div class="preview-state empty">
      <FileText aria-hidden="true" />
      <p>暂无笔记</p>
    </div>
  {:else if status === 'error'}
    <div class="preview-state error" role="alert">
      <CircleAlert aria-hidden="true" />
      <p>预览渲染失败</p>
      <span>{error}</span>
      <button type="button" class="retry" aria-label="重新渲染" title="重新渲染" onclick={retry}>
        <RefreshCw />
      </button>
    </div>
  {:else if status === 'loading' && !html}
    <div class="preview-state loading">
      <LoaderCircle class="spinner" aria-hidden="true" />
      <p>正在渲染...</p>
    </div>
  {:else}
    <article class="preview-content" use:routePreviewLinks>{@html html}</article>
    {#if status === 'loading'}
      <div class="updating" aria-label="正在更新预览" title="正在更新预览">
        <LoaderCircle class="spinner" />
      </div>
    {/if}
  {/if}
</div>

<style>
  .note-preview {
    position: relative;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: auto;
    color: var(--reading-text, var(--text-primary, var(--text-h, #27272a)));
    background: var(--surface-raised, var(--bg, #fff));
  }

  .preview-state {
    min-height: 100%;
    box-sizing: border-box;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 8px;
    padding: 28px;
    color: var(--text-subtle, var(--text, #71717a));
    text-align: center;
  }

  .preview-state :global(svg) {
    width: 22px;
    height: 22px;
  }

  .preview-state p,
  .preview-state span {
    margin: 0;
  }

  .preview-state p {
    color: var(--text-muted, var(--text, #52525b));
    font-size: 13px;
    font-weight: 650;
  }

  .preview-state span {
    max-width: 480px;
    font-size: 11px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .preview-state.error :global(svg),
  .preview-state.error p {
    color: var(--danger, #b42318);
  }

  .retry {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    margin-top: 5px;
    padding: 0;
    color: var(--text-muted, var(--text, #52525b));
    background: var(--surface-raised, var(--bg, #fff));
    border: 1px solid var(--border, #e4e4e7);
    border-radius: 5px;
    cursor: pointer;
  }

  .retry:hover {
    color: var(--text-primary, var(--text-h, #18181b));
    background: var(--surface-hover, #f4f4f5);
  }

  .retry:focus-visible {
    outline: 2px solid var(--accent, #7c3aed);
    outline-offset: 2px;
  }

  .retry :global(svg) {
    width: 15px;
    height: 15px;
  }

  .preview-content {
    max-width: 780px;
    min-height: 100%;
    box-sizing: border-box;
    margin: 0 auto;
    padding: 24px clamp(18px, 3vw, 38px) 64px;
    font: 15px/1.75 var(--font-serif, ui-serif, Georgia, serif);
    overflow-wrap: anywhere;
  }

  .preview-content :global(h1),
  .preview-content :global(h2),
  .preview-content :global(h3),
  .preview-content :global(h4),
  .preview-content :global(h5),
  .preview-content :global(h6) {
    margin: 1.35em 0 0.55em;
    color: var(--text-primary, var(--text-h, #18181b));
    font-family: var(--font-sans, var(--sans, system-ui, sans-serif));
    font-weight: 680;
    line-height: 1.3;
    letter-spacing: 0;
  }

  .preview-content :global(h1) { margin-top: 0; font-size: 24px; }
  .preview-content :global(h2) { font-size: 20px; }
  .preview-content :global(h3) { font-size: 17px; }
  .preview-content :global(h4),
  .preview-content :global(h5),
  .preview-content :global(h6) { font-size: 15px; }

  .preview-content :global(p),
  .preview-content :global(ul),
  .preview-content :global(ol),
  .preview-content :global(blockquote),
  .preview-content :global(pre),
  .preview-content :global(table) {
    margin: 0 0 1em;
  }

  .preview-content :global(ul),
  .preview-content :global(ol) {
    padding-left: 1.6em;
  }

  .preview-content :global(a) {
    color: var(--link, #2563eb);
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }

  .preview-content :global(blockquote) {
    padding-left: 16px;
    color: var(--text-muted, var(--text, #52525b));
    border-left: 3px solid var(--border-strong, var(--border, #d4d4d8));
  }

  .preview-content :global(code) {
    display: inline;
    padding: 0.12em 0.32em;
    background: var(--code-bg, #f4f4f5);
    border-radius: 3px;
    font: 0.88em/1.5 var(--font-mono, var(--mono, ui-monospace, monospace));
  }

  .preview-content :global(pre) {
    overflow: auto;
    padding: 13px 15px;
    background: var(--code-bg, #f4f4f5);
    border: 1px solid var(--border, #e4e4e7);
    border-radius: 5px;
  }

  .preview-content :global(pre code) {
    display: inline;
    padding: 0;
    background: transparent;
  }

  .preview-content :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-sans, var(--sans, system-ui, sans-serif));
    font-size: 12px;
  }

  .preview-content :global(th),
  .preview-content :global(td) {
    padding: 7px 9px;
    border: 1px solid var(--border, #e4e4e7);
    text-align: left;
  }

  .preview-content :global(img) {
    max-width: 100%;
    height: auto;
  }

  .preview-content :global(mjx-container) {
    max-width: 100%;
    color: var(--text-primary, var(--text-h, #18181b));
  }

  .preview-content :global(mjx-container[display]) {
    overflow-x: auto;
    overflow-y: hidden;
  }

  .updating {
    position: sticky;
    right: 10px;
    bottom: 10px;
    float: right;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    color: var(--text-subtle, var(--text, #71717a));
    background: var(--surface-raised, var(--bg, #fff));
    border: 1px solid var(--border, #e4e4e7);
    border-radius: 5px;
  }

  .updating :global(svg) {
    width: 14px;
    height: 14px;
  }

  .note-preview :global(.spinner) {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .note-preview :global(.spinner) { animation: none; }
  }
</style>
