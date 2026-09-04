import { appState, DEFAULT_SETTINGS } from './state.svelte'
import { flushStore, readStoreValue, writeStoreValue } from '../lib/store'
import type { AppSettings, Deadline, EntriesByFeed, FeedSource, PaperNotes } from '../types'

export const SCHEMA_VERSION = 1

function normalizeSettings(value: Partial<AppSettings> | null): AppSettings {
  const settings = { ...DEFAULT_SETTINGS, ...(value ?? {}) }
  settings.refreshIntervalMinutes = Math.max(1, Number(settings.refreshIntervalMinutes) || 30)
  settings.maxEntriesPerFeed = Math.min(1000, Math.max(10, Number(settings.maxEntriesPerFeed) || 200))
  if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system'
  return settings
}

export async function hydrateAppState(): Promise<void> {
  try {
    const [schemaVersion, settings, feeds, entries, deadlines, paperNotes] = await Promise.all([
      readStoreValue('schemaVersion', 0),
      readStoreValue<Partial<AppSettings>>('settings', DEFAULT_SETTINGS),
      readStoreValue<FeedSource[]>('feeds', []),
      readStoreValue<EntriesByFeed>('entries', {}),
      readStoreValue<Deadline[]>('deadlines', []),
      readStoreValue<PaperNotes>('paperNotes', {}),
    ])

    appState.settings = normalizeSettings(settings)
    appState.feeds = Array.isArray(feeds) ? feeds : []
    appState.entries = entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : {}
    appState.deadlines = Array.isArray(deadlines) ? deadlines : []
    appState.paperNotes = paperNotes && typeof paperNotes === 'object' && !Array.isArray(paperNotes) ? paperNotes : {}

    if (schemaVersion > SCHEMA_VERSION) {
      appState.startupError = '本地数据由更高版本的 Research Desk 创建，部分字段可能无法识别。'
      return
    }
    await Promise.all([
      writeStoreValue('schemaVersion', SCHEMA_VERSION),
      writeStoreValue('settings', appState.settings),
      writeStoreValue('feeds', appState.feeds),
      writeStoreValue('entries', appState.entries),
      writeStoreValue('deadlines', appState.deadlines),
      writeStoreValue('paperNotes', appState.paperNotes),
    ])
  } catch (error) {
    appState.startupError = `无法读取本地数据：${error instanceof Error ? error.message : String(error)}`
  } finally {
    appState.initialized = true
  }
}

export const persistSettings = () => writeStoreValue('settings', appState.settings)
export const persistFeeds = () => writeStoreValue('feeds', appState.feeds)
export const persistEntries = () => writeStoreValue('entries', appState.entries)
export const persistDeadlines = () => writeStoreValue('deadlines', appState.deadlines)
export const persistPaperNotes = () => writeStoreValue('paperNotes', appState.paperNotes)

export async function flushPersistence(): Promise<void> {
  await Promise.all([
    persistSettings(),
    persistFeeds(),
    persistEntries(),
    persistDeadlines(),
    persistPaperNotes(),
  ])
  await flushStore()
}
