import { parseFeed } from 'feedsmith'
import { fetchText } from '../../lib/http'
import { parseDateTimestamp } from '../../lib/date'
import type { FeedEntry, FeedSource } from '../../types'

interface ParsedFeed {
  title?: string
  siteUrl?: string
  entries: FeedEntry[]
}

export interface RefreshFeedResult {
  feed: FeedSource
  entries: FeedEntry[] | null
}

let sanitizerPromise: Promise<typeof import('../../lib/sanitize')> | undefined
let sanitizeFeedHtml: typeof import('../../lib/sanitize')['sanitizeFeedHtml']
let textFromHtml: typeof import('../../lib/sanitize')['textFromHtml']

async function loadSanitizer(): Promise<void> {
  sanitizerPromise ??= import('../../lib/sanitize')
  const sanitizer = await sanitizerPromise
  sanitizeFeedHtml = sanitizer.sanitizeFeedHtml
  textFromHtml = sanitizer.textFromHtml
}

function firstValue(values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim()
}

function cleanAuthors(values?: Array<string | undefined>): string[] | undefined {
  const authors = values?.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim())
  return authors?.length ? authors : undefined
}

function entryId(feedId: string, sourceId: string | undefined, title: string, publishedAt?: number): string {
  const identity = sourceId?.trim() || `${title.trim()}|${publishedAt ?? 0}`
  return `${feedId}:${identity}`
}

function cleanContent(value?: string): string | undefined {
  if (!value?.trim()) return undefined
  const cleaned = sanitizeFeedHtml(value)
  return cleaned.trim() || undefined
}

function plainTextContent(value?: string): string | undefined {
  if (!value?.trim()) return undefined
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>')
  return escaped.trim() || undefined
}

function plainTextSummary(value?: string): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

function webUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value.trim(), baseUrl)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function summaryFrom(primary?: string, fallback?: string): string | undefined {
  const value = textFromHtml(primary) || textFromHtml(fallback)
  return value || undefined
}

export async function parseFeedDocument(
  source: string,
  feed: FeedSource,
  _maxItems: number,
): Promise<ParsedFeed> {
  await loadSanitizer()
  const parsed = parseFeed(source)
  const fetchedAt = Date.now()

  if (parsed.format === 'rss') {
    const result = parsed.feed
    return {
      title: result.title,
      siteUrl: webUrl(result.link, feed.feedUrl),
      entries: (result.items ?? []).map((item) => {
        const title = firstValue([item.title, item.dc?.titles?.[0]]) ?? '无标题'
        const rawUrl = firstValue([
          item.link,
          item.atom?.links?.find((link) => link.rel === 'alternate' || !link.rel)?.href,
        ])
        const url = webUrl(rawUrl, feed.feedUrl)
        const publishedAt = parseDateTimestamp(
          firstValue([item.pubDate, item.atom?.published, item.atom?.updated, item.dc?.dates?.[0]]),
        )
        const authors = cleanAuthors(
          item.authors ?? item.dc?.creators ?? item.atom?.authors?.map((author) => author.name),
        )
        const contentSource = firstValue([item.content?.encoded, item.atom?.content])
        const summarySource = firstValue([item.description, item.atom?.summary, item.dc?.descriptions?.[0]])
        return {
          id: entryId(feed.id, firstValue([item.guid?.value, item.atom?.id, url]), title, publishedAt),
          feedId: feed.id,
          title,
          url,
          author: authors?.join(', '),
          authors,
          summary: summaryFrom(summarySource, contentSource),
          content: cleanContent(contentSource ?? summarySource),
          publishedAt,
          fetchedAt,
          isRead: false,
          isStarred: false,
        }
      }),
    }
  }

  if (parsed.format === 'atom') {
    const result = parsed.feed
    const siteUrl = webUrl(
      result.links?.find((link) => link.rel === 'alternate' || !link.rel)?.href,
      feed.feedUrl,
    )
    return {
      title: result.title,
      siteUrl,
      entries: (result.entries ?? []).map((item) => {
        const title = item.title?.trim() || '无标题'
        const alternate = webUrl(
          item.links?.find((link) => link.rel === 'alternate' || !link.rel)?.href,
          feed.feedUrl,
        )
        const pdfUrl = webUrl(
          item.links?.find(
            (link) => link.type === 'application/pdf' || link.title?.toLowerCase() === 'pdf',
          )?.href,
          feed.feedUrl,
        )
        const publishedAt = parseDateTimestamp(firstValue([item.published, item.updated]))
        const authors = cleanAuthors((item.authors ?? result.authors)?.map((author) => author.name))
        const contentSource = firstValue([item.content, item.summary])
        return {
          id: entryId(feed.id, firstValue([item.id, alternate]), title, publishedAt),
          feedId: feed.id,
          title,
          url: alternate ?? webUrl(item.id, feed.feedUrl),
          pdfUrl,
          author: authors?.join(', '),
          authors,
          summary: summaryFrom(item.summary, item.content),
          content: cleanContent(contentSource),
          publishedAt,
          fetchedAt,
          isRead: false,
          isStarred: false,
        }
      }),
    }
  }

  if (parsed.format === 'json') {
    const result = parsed.feed
    return {
      title: result.title,
      siteUrl: webUrl(result.home_page_url, feed.feedUrl),
      entries: (result.items ?? []).map((item) => {
        const title = item.title?.trim() || '无标题'
        const url = webUrl(item.url ?? item.external_url, feed.feedUrl)
        const publishedAt = parseDateTimestamp(firstValue([item.date_published, item.date_modified]))
        const authors = cleanAuthors((item.authors ?? result.authors)?.map((author) => author.name))
        const content = item.content_html
          ? cleanContent(item.content_html)
          : plainTextContent(item.content_text ?? item.summary)
        return {
          id: entryId(feed.id, firstValue([item.id, url]), title, publishedAt),
          feedId: feed.id,
          title,
          url,
          author: authors?.join(', '),
          authors,
          summary: plainTextSummary(item.summary ?? item.content_text) ?? summaryFrom(item.content_html),
          content,
          publishedAt,
          fetchedAt,
          isRead: false,
          isStarred: false,
        }
      }),
    }
  }

  const result = parsed.feed
  return {
    title: result.title,
    siteUrl: webUrl(result.link, feed.feedUrl),
    entries: (result.items ?? []).map((item) => {
      const title = firstValue([item.title, item.dc?.titles?.[0]]) ?? '无标题'
      const url = webUrl(item.link, feed.feedUrl)
      const publishedAt = parseDateTimestamp(
        firstValue([item.atom?.published, item.atom?.updated, item.dc?.dates?.[0]]),
      )
      const authors = cleanAuthors(item.atom?.authors?.map((author) => author.name) ?? item.dc?.creators)
      const contentSource = firstValue([item.content?.encoded, item.atom?.content])
      const summarySource = firstValue([item.description, item.atom?.summary, item.dc?.descriptions?.[0]])
      return {
        id: entryId(feed.id, firstValue([item.rdf?.about, item.atom?.id, url]), title, publishedAt),
        feedId: feed.id,
        title,
        url,
        author: authors?.join(', '),
        authors,
        summary: summaryFrom(summarySource, contentSource),
        content: cleanContent(contentSource ?? summarySource),
        publishedAt,
        fetchedAt,
        isRead: false,
        isStarred: false,
      }
    }),
  }
}

export function mergeEntries(
  existing: FeedEntry[],
  incoming: FeedEntry[],
  maxEntries: number,
): FeedEntry[] {
  const previous = new Map(existing.map((entry) => [entry.id, entry]))
  const merged = new Map<string, FeedEntry>()

  for (const entry of incoming) {
    const old = previous.get(entry.id)
    merged.set(entry.id, old ? { ...entry, isRead: old.isRead, isStarred: old.isStarred } : entry)
  }
  for (const entry of existing) {
    if (!merged.has(entry.id)) merged.set(entry.id, entry)
  }

  return [...merged.values()]
    .sort((left, right) => (right.publishedAt ?? right.fetchedAt) - (left.publishedAt ?? left.fetchedAt))
    .slice(0, maxEntries)
}

let arxivRequestQueue = Promise.resolve()
let lastArxivRequestAt = 0

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function scheduleArxivRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = arxivRequestQueue.then(async () => {
    const remaining = 3_000 - (Date.now() - lastArxivRequestAt)
    if (remaining > 0) await wait(remaining)
    lastArxivRequestAt = Date.now()
    return request()
  })
  arxivRequestQueue = result.then(() => undefined, () => undefined)
  return result
}

async function requestFeed(feed: FeedSource, headers: Headers): Promise<{ response: Response; text: string }> {
  const request = () => fetchText(feed.feedUrl, { headers })
  return feed.kind === 'arxiv' ? scheduleArxivRequest(request) : request()
}

export async function refreshFeedSource(feed: FeedSource, maxEntries: number): Promise<RefreshFeedResult> {
  const headers = new Headers({ Accept: 'application/atom+xml, application/rss+xml, application/feed+json, application/json, text/xml, */*' })
  if (feed.etag) headers.set('If-None-Match', feed.etag)
  if (feed.lastModified) headers.set('If-Modified-Since', feed.lastModified)

  let { response, text } = await requestFeed(feed, headers)
  if (response.status === 412 && (feed.etag || feed.lastModified)) {
    const unconditionalHeaders = new Headers(headers)
    unconditionalHeaders.delete('If-None-Match')
    unconditionalHeaders.delete('If-Modified-Since')
    ;({ response, text } = await requestFeed(feed, unconditionalHeaders))
  }
  if (response.status === 304) {
    return {
      feed: {
        ...feed,
        etag: response.headers.get('etag') ?? feed.etag,
        lastModified: response.headers.get('last-modified') ?? feed.lastModified,
        lastUpdatedAt: Date.now(),
        errorMessage: undefined,
      },
      entries: null,
    }
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  if (!text.trim()) throw new Error('响应内容为空')

  const parseBase = response.url || feed.feedUrl
  const parsed = await parseFeedDocument(text, { ...feed, feedUrl: parseBase }, maxEntries)
  return {
    feed: {
      ...feed,
      title: feed.title.trim() || parsed.title?.trim() || feed.feedUrl,
      siteUrl: parsed.siteUrl ?? feed.siteUrl,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      lastUpdatedAt: Date.now(),
      errorMessage: undefined,
    },
    entries: parsed.entries,
  }
}
