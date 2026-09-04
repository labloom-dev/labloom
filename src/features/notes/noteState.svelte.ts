import { persistPaperNotes } from '../../app/persistence'
import { appState } from '../../app/state.svelte'
import { debounce } from '../../lib/debounce'

export type NoteSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

let persistenceQueue = Promise.resolve()

function queuePaperNotesPersistence(): Promise<void> {
  const save = persistenceQueue.then(() => persistPaperNotes())
  persistenceQueue = save.catch(() => undefined)
  return save
}

export class NoteState {
  itemKey = $state('')
  title = $state('')
  markdown = $state('')
  saveState = $state<NoteSaveState>('idle')
  saveError = $state('')

  #revision = 0
  #destroyed = false
  #lastSave: Promise<void> = Promise.resolve()
  #scheduleSave = debounce((revision: number, itemKey: string) => {
    if (!this.#destroyed && itemKey === this.itemKey) this.saveState = 'saving'

    const save = queuePaperNotesPersistence()
    this.#lastSave = save
    void save.then(
      () => {
        if (this.#destroyed || itemKey !== this.itemKey || revision !== this.#revision) return
        this.saveState = 'saved'
        this.saveError = ''
      },
      (error: unknown) => {
        if (this.#destroyed || itemKey !== this.itemKey || revision !== this.#revision) return
        this.saveState = 'error'
        this.saveError = error instanceof Error ? error.message : String(error)
      },
    )
  }, 800)

  constructor(itemKey: string, title: string) {
    this.itemKey = itemKey
    this.title = title
    this.load(itemKey)
  }

  setMarkdown(value: string): void {
    if (value === this.markdown || !this.itemKey) return

    this.markdown = value
    const revision = ++this.#revision
    appState.paperNotes = {
      ...appState.paperNotes,
      [this.itemKey]: {
        zoteroItemKey: this.itemKey,
        title: this.title || undefined,
        markdown: value,
        updatedAt: Date.now(),
      },
    }
    this.saveState = 'dirty'
    this.saveError = ''
    this.#scheduleSave(revision, this.itemKey)
  }

  switchItem(itemKey: string, title: string): void {
    if (itemKey === this.itemKey) {
      if (title !== this.title) this.updateTitle(title)
      return
    }

    void this.flush().catch(() => undefined)
    this.itemKey = itemKey
    this.title = title
    this.saveError = ''
    this.load(itemKey)
  }

  flush(): Promise<void> {
    this.#scheduleSave.flush()
    return this.#lastSave
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#scheduleSave.flush()
    this.#destroyed = true
  }

  private load(itemKey: string): void {
    const note = itemKey ? appState.paperNotes[itemKey] : undefined
    this.markdown = note?.markdown ?? ''
    this.saveState = note ? 'saved' : 'idle'
  }

  private updateTitle(title: string): void {
    this.title = title
    const current = this.itemKey ? appState.paperNotes[this.itemKey] : undefined
    if (!current || current.title === title) return

    const revision = ++this.#revision
    appState.paperNotes = {
      ...appState.paperNotes,
      [this.itemKey]: { ...current, title: title || undefined },
    }
    this.saveState = 'dirty'
    this.#scheduleSave(revision, this.itemKey)
  }
}

export function createNoteState(itemKey: string, title: string): NoteState {
  return new NoteState(itemKey, title)
}
