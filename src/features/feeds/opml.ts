import { generateOpml, parseOpml } from 'feedsmith'
import type { FeedSource } from '../../types'

interface OpmlOutline {
  text?: string
  title?: string
  type?: string
  xmlUrl?: string
  htmlUrl?: string
  outlines?: OpmlOutline[]
}

export interface ImportedFeed {
  title: string
  feedUrl: string
  siteUrl?: string
  folder?: string
}

function collectOutlines(outlines: OpmlOutline[], folder?: string): ImportedFeed[] {
  const feeds: ImportedFeed[] = []
  for (const outline of outlines) {
    const label = outline.title?.trim() || outline.text?.trim() || '未命名订阅'
    if (outline.xmlUrl?.trim()) {
      feeds.push({
        title: label,
        feedUrl: outline.xmlUrl.trim(),
        siteUrl: outline.htmlUrl?.trim() || undefined,
        folder,
      })
    }
    if (outline.outlines?.length) {
      const nestedFolder = outline.xmlUrl ? folder : folder ? `${folder}/${label}` : label
      feeds.push(...collectOutlines(outline.outlines, nestedFolder))
    }
  }
  return feeds
}

export function importOpmlDocument(source: string): ImportedFeed[] {
  const document = parseOpml(source) as unknown as { body?: { outlines?: OpmlOutline[] } }
  const feeds = collectOutlines(document.body?.outlines ?? [])
  if (!feeds.length) throw new Error('OPML 中没有找到可用订阅')
  return feeds
}

export function exportOpmlDocument(feeds: FeedSource[]): string {
  const grouped = new Map<string, FeedSource[]>()
  for (const feed of feeds) {
    const key = feed.folder?.trim() ?? ''
    grouped.set(key, [...(grouped.get(key) ?? []), feed])
  }

  const feedOutline = (feed: FeedSource) => ({
    text: feed.title,
    title: feed.title,
    type: 'rss',
    xmlUrl: feed.feedUrl,
    ...(feed.siteUrl ? { htmlUrl: feed.siteUrl } : {}),
  })
  const outlines = [
    ...(grouped.get('') ?? []).map(feedOutline),
    ...[...grouped.entries()]
      .filter(([folder]) => folder)
      .map(([folder, folderFeeds]) => ({ text: folder, title: folder, outlines: folderFeeds.map(feedOutline) })),
  ]

  return generateOpml({
    head: { title: 'Research Desk subscriptions', dateCreated: new Date() },
    body: { outlines },
  })
}
