import { appState } from '../../app/state.svelte'
import { persistEntries, persistFeeds } from '../../app/persistence'
import type { FeedEntry, FeedSource } from '../../types'
import { mergeEntries, refreshFeedSource } from './feed'

export type FeedScope = 'all' | 'unread' | 'starred' | string

export function entriesForKind(kind: FeedSource['kind']): FeedEntry[] {
  const feedIds = new Set(appState.feeds.filter((feed) => feed.kind === kind).map((feed) => feed.id))
  return Object.values(appState.entries)
    .flat()
    .filter((entry) => feedIds.has(entry.feedId))
    .sort((left, right) => (right.publishedAt ?? right.fetchedAt) - (left.publishedAt ?? left.fetchedAt))
}

export function unreadCount(feedId: string): number {
  return (appState.entries[feedId] ?? []).filter((entry) => !entry.isRead).length
}

function normalizeFeedUrl(value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('订阅地址必须使用 HTTP 或 HTTPS')
  return url.toString()
}

export async function addFeed(source: Omit<FeedSource, 'id'>): Promise<FeedSource> {
  const normalizedSource = { ...source, feedUrl: normalizeFeedUrl(source.feedUrl) }
  const duplicate = appState.feeds.find((feed) => feed.feedUrl === normalizedSource.feedUrl)
  if (duplicate) throw new Error('该订阅已存在')
  const feed: FeedSource = { ...normalizedSource, id: crypto.randomUUID() }
  const previousFeeds = appState.feeds
  const previousEntries = appState.entries
  appState.feeds = [...appState.feeds, feed]
  appState.entries = { ...appState.entries, [feed.id]: [] }
  try {
    await Promise.all([persistFeeds(), persistEntries()])
  } catch (error) {
    appState.feeds = previousFeeds
    appState.entries = previousEntries
    await Promise.allSettled([persistFeeds(), persistEntries()])
    throw error
  }
  await refreshOneFeed(feed.id)
  return appState.feeds.find((item) => item.id === feed.id) ?? feed
}

export async function updateFeed(feedId: string, changes: Pick<FeedSource, 'title' | 'folder'>): Promise<void> {
  const previous = appState.feeds
  const next = previous.map((feed) => (feed.id === feedId ? { ...feed, ...changes } : feed))
  appState.feeds = next
  try {
    await persistFeeds()
  } catch (error) {
    if (appState.feeds === next) appState.feeds = previous
    throw error
  }
}

export async function removeFeed(feedId: string): Promise<void> {
  const previousFeeds = appState.feeds
  const previousEntries = appState.entries
  const previousSelectedFeedId = appState.selectedFeedId
  const previousSelectedEntryId = appState.selectedEntryId
  appState.feeds = previousFeeds.filter((feed) => feed.id !== feedId)
  const { [feedId]: _removed, ...remainingEntries } = appState.entries
  appState.entries = remainingEntries
  if (appState.selectedFeedId === feedId) appState.selectedFeedId = null
  if (appState.selectedEntryId && !Object.values(remainingEntries).flat().some((entry) => entry.id === appState.selectedEntryId)) {
    appState.selectedEntryId = null
  }
  try {
    await Promise.all([persistFeeds(), persistEntries()])
  } catch (error) {
    appState.feeds = previousFeeds
    appState.entries = previousEntries
    appState.selectedFeedId = previousSelectedFeedId
    appState.selectedEntryId = previousSelectedEntryId
    await Promise.allSettled([persistFeeds(), persistEntries()])
    throw error
  }
}

export async function refreshOneFeed(feedId: string): Promise<boolean> {
  if (appState.refreshingFeedIds.includes(feedId)) return true
  const feed = appState.feeds.find((item) => item.id === feedId)
  if (!feed) return false
  appState.refreshingFeedIds = [...appState.refreshingFeedIds, feedId]

  try {
    let result = await refreshFeedSource(feed, appState.settings.maxEntriesPerFeed)
    if (result.entries === null && !(appState.entries[feedId]?.length) && (feed.etag || feed.lastModified)) {
      result = await refreshFeedSource({ ...feed, etag: undefined, lastModified: undefined }, appState.settings.maxEntriesPerFeed)
    }

    const current = appState.feeds.find((item) => item.id === feedId)
    if (!current || current.feedUrl !== feed.feedUrl) return true
    const refreshedFeed: FeedSource = {
      ...current,
      title: current.title.trim() || result.feed.title,
      siteUrl: result.feed.siteUrl ?? current.siteUrl,
      etag: result.feed.etag,
      lastModified: result.feed.lastModified,
      lastUpdatedAt: result.feed.lastUpdatedAt,
      errorMessage: undefined,
    }
    appState.feeds = appState.feeds.map((item) => (item.id === feedId ? refreshedFeed : item))
    if (result.entries) {
      appState.entries = {
        ...appState.entries,
        [feedId]: mergeEntries(
          appState.entries[feedId] ?? [],
          result.entries,
          appState.settings.maxEntriesPerFeed,
        ),
      }
      await Promise.all([persistFeeds(), persistEntries()])
    } else {
      const currentEntries = appState.entries[feedId] ?? []
      const prunedEntries = currentEntries.slice(0, appState.settings.maxEntriesPerFeed)
      if (prunedEntries.length !== currentEntries.length) {
        appState.entries = { ...appState.entries, [feedId]: prunedEntries }
        await Promise.all([persistFeeds(), persistEntries()])
      } else {
        await persistFeeds()
      }
    }
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (appState.feeds.some((item) => item.id === feedId)) {
      appState.feeds = appState.feeds.map((item) =>
        item.id === feedId ? { ...item, errorMessage: `刷新失败：${message}` } : item,
      )
      try {
        await persistFeeds()
      } catch {
        // The in-memory error remains visible even if the disk is unavailable.
      }
    }
    return false
  } finally {
    appState.refreshingFeedIds = appState.refreshingFeedIds.filter((id) => id !== feedId)
  }
}

export async function refreshAllFeeds(kind?: FeedSource['kind']): Promise<{ success: number; failed: number }> {
  if (appState.refreshingAll) return { success: 0, failed: 0 }
  const feeds = appState.feeds.filter((feed) => !kind || feed.kind === kind)
  appState.refreshingAll = true
  try {
    const results = await Promise.all(feeds.map((feed) => refreshOneFeed(feed.id)))
    const success = results.filter(Boolean).length
    return { success, failed: results.length - success }
  } finally {
    appState.refreshingAll = false
  }
}

export async function setEntryRead(entryId: string, isRead: boolean): Promise<void> {
  const previous = appState.entries
  updateEntry(entryId, { isRead })
  const next = appState.entries
  try {
    await persistEntries()
  } catch (error) {
    if (appState.entries === next) appState.entries = previous
    throw error
  }
}

export async function toggleEntryStar(entryId: string): Promise<void> {
  const entry = Object.values(appState.entries).flat().find((item) => item.id === entryId)
  if (!entry) return
  const previous = appState.entries
  updateEntry(entryId, { isStarred: !entry.isStarred })
  const next = appState.entries
  try {
    await persistEntries()
  } catch (error) {
    if (appState.entries === next) appState.entries = previous
    throw error
  }
}

function updateEntry(entryId: string, changes: Partial<Pick<FeedEntry, 'isRead' | 'isStarred'>>): void {
  const next = { ...appState.entries }
  for (const [feedId, entries] of Object.entries(next)) {
    if (!entries.some((entry) => entry.id === entryId)) continue
    next[feedId] = entries.map((entry) => (entry.id === entryId ? { ...entry, ...changes } : entry))
    break
  }
  appState.entries = next
}
