export interface MarkdownEditor {
  destroy: () => void
  focus: () => void
  setValue: (value: string) => void
}

interface CreateMarkdownEditorOptions {
  parent: HTMLElement
  value: string
  ariaLabel?: string
  autofocus?: boolean
  onChange: (value: string) => void
}

export async function createMarkdownEditor({
  parent,
  value,
  ariaLabel = 'Markdown note editor',
  autofocus = false,
  onChange,
}: CreateMarkdownEditorOptions): Promise<MarkdownEditor> {
  const [{ EditorView, minimalSetup }, { markdown }] = await Promise.all([
    import('codemirror'),
    import('@codemirror/lang-markdown'),
  ])

  let applyingExternalValue = false
  const view = new EditorView({
    parent,
    doc: value,
    extensions: [
      minimalSetup,
      markdown(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        spellcheck: 'false',
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingExternalValue) onChange(update.state.doc.toString())
      }),
    ],
  })

  if (autofocus) view.focus()

  return {
    destroy: () => view.destroy(),
    focus: () => view.focus(),
    setValue: (nextValue) => {
      const currentValue = view.state.doc.toString()
      if (nextValue === currentValue) return

      applyingExternalValue = true
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: nextValue },
        })
      } finally {
        applyingExternalValue = false
      }
    },
  }
}
