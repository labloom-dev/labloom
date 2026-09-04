import type {
  AppSettings,
  AppView,
  Deadline,
  EntriesByFeed,
  FeedSource,
  PaperNotes,
  ToastMessage,
  ZoteroCollection,
  ZoteroItem,
} from '../types'

export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalMinutes: 30,
  maxEntriesPerFeed: 200,
  zoteroBaseUrl: 'http://localhost:23119/api',
  ccfFeedUrl: '',
  theme: 'system',
}

interface RuntimeState {
  currentView: AppView
  selectedFeedId: string | null
  selectedEntryId: string | null
  feeds: FeedSource[]
  entries: EntriesByFeed
  deadlines: Deadline[]
  paperNotes: PaperNotes
  settings: AppSettings
  initialized: boolean
  startupError: string
  refreshingFeedIds: string[]
  refreshingAll: boolean
  zoteroConnected: boolean
  zoteroLoading: boolean
  zoteroError: string
  zoteroCollections: ZoteroCollection[]
  zoteroItems: ZoteroItem[]
  selectedZoteroItemKey: string | null
  toast: ToastMessage | null
}

export const appState = $state<RuntimeState>({
  currentView: 'feeds',
  selectedFeedId: null,
  selectedEntryId: null,
  feeds: [],
  entries: {},
  deadlines: [],
  paperNotes: {},
  settings: { ...DEFAULT_SETTINGS },
  initialized: false,
  startupError: '',
  refreshingFeedIds: [],
  refreshingAll: false,
  zoteroConnected: false,
  zoteroLoading: false,
  zoteroError: '',
  zoteroCollections: [],
  zoteroItems: [],
  selectedZoteroItemKey: null,
  toast: null,
})

let toastTimer: ReturnType<typeof setTimeout> | undefined
let toastId = 0

export function showToast(message: string, kind: ToastMessage['kind'] = 'info'): void {
  if (toastTimer) clearTimeout(toastTimer)
  appState.toast = { id: ++toastId, kind, message }
  toastTimer = setTimeout(() => {
    appState.toast = null
  }, 4200)
}

export function clearToast(): void {
  if (toastTimer) clearTimeout(toastTimer)
  appState.toast = null
}
