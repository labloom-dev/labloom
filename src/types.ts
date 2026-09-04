export type AppView = 'feeds' | 'arxiv' | 'deadlines' | 'zotero'

export type Theme = 'system' | 'light' | 'dark'

export interface AppSettings {
  refreshIntervalMinutes: number
  maxEntriesPerFeed: number
  zoteroBaseUrl: string
  ccfFeedUrl: string
  theme: Theme
}

export interface FeedSource {
  id: string
  kind: 'rss' | 'arxiv'
  title: string
  feedUrl: string
  siteUrl?: string
  folder?: string
  etag?: string
  lastModified?: string
  lastUpdatedAt?: number
  errorMessage?: string
}

export interface FeedEntry {
  id: string
  feedId: string
  title: string
  url?: string
  pdfUrl?: string
  author?: string
  authors?: string[]
  summary?: string
  content?: string
  publishedAt?: number
  fetchedAt: number
  isRead: boolean
  isStarred: boolean
}

export type EntriesByFeed = Record<string, FeedEntry[]>

export interface Deadline {
  id: string
  title: string
  type: 'conference' | 'journal'
  deadlineAt: string
  timezoneLabel: string
  url?: string
  note?: string
  source: 'manual' | 'csv' | 'ccf'
}

export interface PaperNote {
  zoteroItemKey: string
  title?: string
  markdown: string
  updatedAt: number
}

export type PaperNotes = Record<string, PaperNote>

export interface ZoteroCollection {
  key: string
  name: string
  parentCollection?: string
  itemCount?: number
}

export interface ZoteroCreator {
  firstName?: string
  lastName?: string
  name?: string
  creatorType?: string
}

export interface ZoteroItem {
  key: string
  title: string
  itemType: string
  creators: ZoteroCreator[]
  year?: string
  abstractNote?: string
  tags: string[]
  collections: string[]
  url?: string
  attachmentUrl?: string
}

export interface ToastMessage {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}
