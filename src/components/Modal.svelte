<script lang="ts">
  import type { Snippet } from 'svelte'
  import { X } from '@lucide/svelte'
  import IconButton from './IconButton.svelte'

  interface Props {
    title: string
    onclose: () => void
    children: Snippet
    width?: string
  }

  let { title, onclose, children, width = '480px' }: Props = $props()

  function handleBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) onclose()
  }

  function manageDialog(node: HTMLElement): { destroy: () => void } {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appShell = document.querySelector<HTMLElement>('.app-shell')
    const wasInert = appShell?.hasAttribute('inert') ?? false
    appShell?.setAttribute('inert', '')

    const focusable = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )]
    const focusFrame = requestAnimationFrame(() => {
      const initial = node.querySelector<HTMLElement>('.body input, .body select, .body textarea')
        ?? focusable()[0]
        ?? node
      initial.focus()
    })

    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onclose()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) {
        event.preventDefault()
        node.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    node.addEventListener('keydown', keydown)

    return {
      destroy: () => {
        cancelAnimationFrame(focusFrame)
        node.removeEventListener('keydown', keydown)
        if (!wasInert) appShell?.removeAttribute('inert')
        previousFocus?.focus()
      },
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={handleBackdrop}>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    tabindex="-1"
    style:--modal-width={width}
    use:manageDialog
  >
    <header>
      <h2 id="modal-title">{title}</h2>
      <IconButton label="关闭" onclick={onclose}><X /></IconButton>
    </header>
    <div class="body">{@render children()}</div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(10 14 18 / 45%);
  }

  .modal {
    width: min(var(--modal-width), calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    overflow: auto;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
  }

  header {
    min-height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 14px 0 18px;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }

  .body {
    padding: 18px;
  }
</style>
