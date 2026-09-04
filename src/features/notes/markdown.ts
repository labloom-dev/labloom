import type { MarkdownIt } from 'markdown-it'
import type { MathjaxInstance, MarkdownItMathjaxOptions } from '@mdit/plugin-mathjax'

export interface MarkdownRenderResult {
  html: string
  styles: string
  error: string
}

interface Renderer {
  markdown: MarkdownIt
  mathjax: MathjaxInstance
  sanitize: (html: string) => string
}

interface RetryError extends Error {
  retry?: Promise<unknown>
}

type FontCharacter = [number?, number?, number?, Record<string, unknown>?]
type FontRanges = Record<string, Record<string, Record<string, FontCharacter>>>
type MutableRecord = Record<string, unknown>

const customMacros = {
  RR: '\\mathbb{R}',
  NN: '\\mathbb{N}',
  ZZ: '\\mathbb{Z}',
  QQ: '\\mathbb{Q}',
  CC: '\\mathbb{C}',
  EE: '\\mathbb{E}',
  Var: '\\operatorname{Var}',
  Cov: '\\operatorname{Cov}',
  argmax: '\\operatorname*{arg\\,max}',
  argmin: '\\operatorname*{arg\\,min}',
  vect: ['\\mathbf{#1}', 1],
} as const

let rendererPromise: Promise<Renderer> | undefined
let renderQueue = Promise.resolve()

function addFontIds(ranges: FontRanges, prefix = ''): Record<string, Record<string, FontCharacter>> {
  const variants: Record<string, Record<string, FontCharacter>> = {}

  for (const id of Object.keys(ranges)) {
    for (const variant of Object.keys(ranges[id])) {
      variants[variant] ??= {}
      const characters = ranges[id][variant]

      if (id) {
        for (const codePoint of Object.keys(characters)) {
          const character = characters[codePoint]
          character[3] ??= {}
          if (prefix) character[3].ff = `${prefix}-${id}`
          else character[3].f = id
        }
      }

      Object.assign(variants[variant], characters)
    }
  }

  return variants
}

function installDynamicFontBridge(instance: MathjaxInstance): void {
  const output = instance.documentOptions.OutputJax as unknown as {
    font?: { constructor?: { dynamicSetup?: (...args: unknown[]) => void } }
  }
  const fontClass = output.font?.constructor
  if (!fontClass?.dynamicSetup) throw new Error('MathJax CHTML font failed to initialize')

  // The packaged dynamic font files are IIFEs and read these specific globals when imported.
  const ensureRecord = (parent: MutableRecord, key: string): MutableRecord => {
    const value = parent[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as MutableRecord
    const created: MutableRecord = {}
    parent[key] = created
    return created
  }
  const host = globalThis as typeof globalThis & { MathJax?: MutableRecord }
  const globalMathjax = (host.MathJax ??= {})
  const internals = ensureRecord(globalMathjax, '_')
  const outputInternals = ensureRecord(internals, 'output')
  const chtml = ensureRecord(outputInternals, 'chtml')
  const fonts = ensureRecord(outputInternals, 'fonts')
  const newcm = ensureRecord(fonts, 'mathjax-newcm')
  const newcmChtml = ensureRecord(newcm, 'chtml_ts')
  const common = ensureRecord(outputInternals, 'common')

  const dynamicFonts = chtml.DynamicFonts
  chtml.DynamicFonts = {
    ...(dynamicFonts && typeof dynamicFonts === 'object' ? dynamicFonts : {}),
    AddFontIds: addFontIds,
  }
  newcmChtml.MathJaxNewcmFont = fontClass
  common.Direction = {
    DIRECTION: { None: '', Vertical: 'v', Horizontal: 'h' },
    V: 'v',
    H: 'h',
  }
}

function localMathjaxUrl(path: string): string {
  const base = new URL(import.meta.env.BASE_URL, document.baseURI)
  return new URL(`mathjax/chtml/${path}`, base).href.replace(/\/$/, '')
}

async function createRenderer(): Promise<Renderer> {
  const [{ default: MarkdownIt }, mathjaxPlugin, { default: DOMPurify }] = await Promise.all([
    import('markdown-it'),
    import('@mdit/plugin-mathjax'),
    import('dompurify'),
  ])

  const tex = {
    packages: ['base', 'ams', 'cases', 'configmacros', 'newcommand', 'noerrors', 'noundefined'],
    macros: customMacros,
  } as unknown as NonNullable<MarkdownItMathjaxOptions['tex']>

  const mathjax = await mathjaxPlugin.createMathjaxInstance({
    output: 'chtml',
    delimiters: 'all',
    a11y: true,
    tex,
    chtml: {
      adaptiveCSS: true,
      displayOverflow: 'scroll',
      fontURL: localMathjaxUrl('woff2'),
      dynamicPrefix: localMathjaxUrl('dynamic'),
    },
  })
  if (!mathjax) throw new Error('MathJax failed to initialize')

  installDynamicFontBridge(mathjax)

  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  })
  markdown.use(mathjaxPlugin.mathjax, mathjax)

  const defaultLinkOpen = markdown.renderer.rules.link_open
  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet('target', '_blank')
    tokens[index].attrSet('rel', 'noopener noreferrer')
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options)
  }

  return {
    markdown,
    mathjax,
    sanitize: (html) =>
      DOMPurify.sanitize(html, {
        FORBID_TAGS: ['img'],
        ADD_ATTR: [
          'accent',
          'accentunder',
          'align',
          'breakable',
          'columnalign',
          'columnlines',
          'columnspacing',
          'columnwidth',
          'data-mjx-texclass',
          'display',
          'displaystyle',
          'fence',
          'frame',
          'framespacing',
          'indentalign',
          'indentshift',
          'inline-breaks',
          'jax',
          'justify',
          'largeop',
          'limits',
          'linethickness',
          'lspace',
          'mathvariant',
          'movablelimits',
          'noic',
          'notation',
          'overflow',
          'rowalign',
          'rowlines',
          'rowspacing',
          'rspace',
          'scriptlevel',
          'side',
          'size',
          'space',
          'stretchy',
          'symmetric',
          'target',
          'texclass',
          'unselectable',
          'valign',
          'width',
        ],
        CUSTOM_ELEMENT_HANDLING: {
          tagNameCheck: /^mjx-[a-z0-9-]+$/,
          allowCustomizedBuiltInElements: false,
        },
      }),
  }
}

function getRenderer(): Promise<Renderer> {
  rendererPromise ??= createRenderer().catch((error: unknown) => {
    rendererPromise = undefined
    throw error
  })
  return rendererPromise
}

async function renderWithRetries(markdown: MarkdownIt, source: string): Promise<string> {
  for (;;) {
    try {
      return markdown.render(source)
    } catch (error) {
      const retry = (error as RetryError | null)?.retry
      if (!(retry instanceof Promise)) throw error
      await retry
    }
  }
}

async function render(source: string): Promise<MarkdownRenderResult> {
  try {
    const renderer = await getRenderer()
    const html = await renderWithRetries(renderer.markdown, source)
    const mathStyles = await renderer.mathjax.outputStyle()
    return { html: renderer.sanitize(html), styles: mathStyles, error: '' }
  } catch (error) {
    return {
      html: '',
      styles: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function renderMarkdown(source: string): Promise<MarkdownRenderResult> {
  const result = renderQueue.then(() => render(source), () => render(source))
  renderQueue = result.then(() => undefined, () => undefined)
  return result
}
