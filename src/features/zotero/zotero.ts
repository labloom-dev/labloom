import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { ZoteroCollection, ZoteroCreator, ZoteroItem } from '../../types'

export const ZOTERO_DISCONNECTED_MESSAGE = '未连接到 Zotero，请先启动 Zotero，并确认本机 API 可用。'

const PAGE_SIZE = 100
const NON_BIBLIOGRAPHIC_TYPES = new Set(['annotation', 'attachment', 'note'])

type JsonRecord = Record<string, unknown>

interface ApiPage {
  values: unknown[]
  total?: number
}

interface AttachmentLink {
  key: string
  url: string
  isPdf: boolean
}

class ZoteroApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ZoteroApiError'
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function apiData(value: unknown): JsonRecord | undefined {
  const record = asRecord(value)
  return asRecord(record?.data) ?? record
}

function apiKey(value: unknown): string | undefined {
  const record = asRecord(value)
  return readString(record?.key) ?? readString(asRecord(record?.data)?.key)
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new ZoteroApiError('Zotero API 地址为空')

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new ZoteroApiError('Zotero API 地址无效')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ZoteroApiError('Zotero API 地址必须使用 HTTP 或 HTTPS')
  }
  return normalized
}

function buildApiUrl(
  baseUrl: string,
  path: string,
  parameters: Record<string, string | number | undefined> = {},
): string {
  const base = `${normalizeBaseUrl(baseUrl)}/`
  const url = new URL(path.replace(/^\/+/, ''), base)
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function requestJson(
  baseUrl: string,
  path: string,
  parameters?: Record<string, string | number | undefined>,
): Promise<{ value: unknown; response: Response }> {
  const url = buildApiUrl(baseUrl, path, parameters)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)
  let response: Response
  try {
    response = await tauriFetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Zotero-API-Version': '3',
      },
    })
    if (!response.ok) {
      throw new ZoteroApiError(
        `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
        response.status,
      )
    }
    return { value: (await response.json()) as unknown, response }
  } catch (error) {
    if (controller.signal.aborted) throw new ZoteroApiError('连接 Zotero 超时')
    if (error instanceof ZoteroApiError) throw error
    if (error instanceof SyntaxError) throw new ZoteroApiError('Zotero API 返回了无法解析的数据')
    throw new ZoteroApiError(error instanceof Error ? error.message : String(error))
  } finally {
    window.clearTimeout(timeout)
  }
}

async function requestPage(
  baseUrl: string,
  path: string,
  start: number,
  limit: number,
): Promise<ApiPage> {
  const { value, response } = await requestJson(baseUrl, path, {
    format: 'json',
    start,
    limit,
  })
  if (!Array.isArray(value)) throw new ZoteroApiError('Zotero API 返回的数据格式不正确')

  const totalHeader = response.headers.get('total-results')
  const total = totalHeader === null ? undefined : Number(totalHeader)
  return {
    values: value,
    total: Number.isFinite(total) ? total : undefined,
  }
}

async function loadPaginated<T extends { key: string }>(
  baseUrl: string,
  path: string,
  parse: (value: unknown) => T | undefined,
): Promise<T[]> {
  const result: T[] = []
  const seenRawKeys = new Set<string>()
  const seenResultKeys = new Set<string>()
  let start = 0

  while (true) {
    const page = await requestPage(baseUrl, path, start, PAGE_SIZE)
    const pageKeys = page.values.map(apiKey).filter((key): key is string => Boolean(key))
    if (start > 0 && pageKeys.length > 0 && pageKeys.every((key) => seenRawKeys.has(key))) break
    if (start > 0 && pageKeys.length === 0) break

    for (const value of page.values) {
      const rawKey = apiKey(value)
      if (rawKey) seenRawKeys.add(rawKey)
      const parsed = parse(value)
      if (parsed && !seenResultKeys.has(parsed.key)) {
        seenResultKeys.add(parsed.key)
        result.push(parsed)
      }
    }

    start += page.values.length
    if (page.values.length < PAGE_SIZE || (page.total !== undefined && start >= page.total)) break
  }

  return result
}

function usableUrl(value: unknown, baseUrl: string, allowRelative = false): string | undefined {
  const source = readString(value)
  if (!source) return undefined
  if (!allowRelative && !/^[a-z][a-z\d+.-]*:/i.test(source)) return undefined

  try {
    const parsed = new URL(source, `${normalizeBaseUrl(baseUrl)}/`)
    return ['http:', 'https:', 'file:', 'zotero:'].includes(parsed.protocol)
      ? parsed.toString()
      : undefined
  } catch {
    return undefined
  }
}

function linkFrom(record: JsonRecord | undefined, name: string, baseUrl: string): {
  url?: string
  type?: string
} {
  const link = asRecord(asRecord(record?.links)?.[name])
  return {
    url: usableUrl(link?.href, baseUrl, true),
    type: readString(link?.type) ?? readString(link?.attachmentType),
  }
}

function attachmentFrom(value: unknown, baseUrl: string): AttachmentLink | undefined {
  const record = asRecord(value)
  const data = apiData(value)
  const key = apiKey(value)
  if (!record || !data || !key) return undefined

  const itemType = readString(data.itemType)
  const contentType = readString(data.contentType)?.toLocaleLowerCase()
  const filename = readString(data.filename) ?? readString(data.path)
  const attachment = linkFrom(record, 'attachment', baseUrl)
  const enclosure = linkFrom(record, 'enclosure', baseUrl)
  const linkedUrl = itemType === 'attachment' ? usableUrl(data.url, baseUrl) : undefined
  const linkedFile = itemType === 'attachment' ? usableUrl(data.path, baseUrl) : undefined
  const url = attachment.url ?? enclosure.url ?? linkedUrl ?? linkedFile
  if (!url) return undefined

  const declaredType = `${attachment.type ?? ''} ${enclosure.type ?? ''} ${contentType ?? ''}`
  return {
    key,
    url,
    isPdf: declaredType.toLocaleLowerCase().includes('pdf') || Boolean(filename?.toLocaleLowerCase().endsWith('.pdf')),
  }
}

function parseCreator(value: unknown): ZoteroCreator | undefined {
  const creator = asRecord(value)
  if (!creator) return undefined
  const firstName = readString(creator.firstName)
  const lastName = readString(creator.lastName)
  const name = readString(creator.name)
  if (!firstName && !lastName && !name) return undefined
  return {
    firstName,
    lastName,
    name,
    creatorType: readString(creator.creatorType),
  }
}

function extractYear(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const match = value.match(/(?:^|\D)((?:1|2)\d{3})(?:\D|$)/)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function parseCollection(value: unknown): ZoteroCollection | undefined {
  const record = asRecord(value)
  const data = apiData(value)
  const key = apiKey(value)
  if (!record || !data || !key) return undefined

  return {
    key,
    name: readString(data.name) ?? '未命名分类',
    parentCollection: readString(data.parentCollection),
    itemCount: readNumber(asRecord(record.meta)?.numItems),
  }
}

function parseItem(value: unknown, baseUrl: string): ZoteroItem | undefined {
  const record = asRecord(value)
  const data = apiData(value)
  const key = apiKey(value)
  const itemType = readString(data?.itemType)
  if (!record || !data || !key || !itemType || NON_BIBLIOGRAPHIC_TYPES.has(itemType)) return undefined

  const creators = Array.isArray(data.creators)
    ? data.creators.map(parseCreator).filter((creator): creator is ZoteroCreator => Boolean(creator))
    : []
  const tags = Array.isArray(data.tags)
    ? data.tags
        .map((tag) => readString(asRecord(tag)?.tag) ?? readString(tag))
        .filter((tag): tag is string => Boolean(tag))
    : []
  const collections = Array.isArray(data.collections)
    ? data.collections.map(readString).filter((key): key is string => Boolean(key))
    : []

  return {
    key,
    title: readString(data.title) ?? '无标题',
    itemType,
    creators,
    year: extractYear(asRecord(record.meta)?.parsedDate, data.date),
    abstractNote: readString(data.abstractNote),
    tags,
    collections,
    url: usableUrl(data.url, baseUrl),
    attachmentUrl: attachmentFrom(value, baseUrl)?.url,
  }
}

function parseChildAttachment(value: unknown, baseUrl: string): AttachmentLink | undefined {
  const data = apiData(value)
  const key = apiKey(value)
  if (!data || !key || readString(data.itemType) !== 'attachment') return undefined

  const detected = attachmentFrom(value, baseUrl)
  if (detected) return detected

  const contentType = readString(data.contentType)?.toLocaleLowerCase()
  const filename = readString(data.filename) ?? readString(data.path)
  const linkMode = readString(data.linkMode)
  const isPdf = contentType?.includes('pdf') === true || filename?.toLocaleLowerCase().endsWith('.pdf') === true
  const isFileAttachment = Boolean(filename) || ['imported_file', 'imported_url', 'linked_file'].includes(linkMode ?? '')
  if (!isFileAttachment) return undefined

  return {
    key,
    url: isPdf
      ? `zotero://open-pdf/library/items/${encodeURIComponent(key)}`
      : buildApiUrl(baseUrl, `users/0/items/${encodeURIComponent(key)}/file/view`),
    isPdf,
  }
}

export function zoteroCreatorName(creator: ZoteroCreator): string {
  if (creator.name?.trim()) return creator.name.trim()
  return [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim()
}

export function zoteroAuthorNames(item: ZoteroItem): string[] {
  const authors = item.creators.filter((creator) => creator.creatorType === 'author')
  return (authors.length ? authors : item.creators)
    .map(zoteroCreatorName)
    .filter((name) => Boolean(name))
}

export function filterZoteroItems(
  items: ZoteroItem[],
  query: string,
  collectionKey: string | null,
): ZoteroItem[] {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  return items.filter((item) => {
    if (collectionKey && !item.collections.includes(collectionKey)) return false
    if (!terms.length) return true
    const searchable = `${item.title} ${zoteroAuthorNames(item).join(' ')}`.toLocaleLowerCase()
    return terms.every((term) => searchable.includes(term))
  })
}

export function zoteroErrorMessage(error: unknown): string {
  if (error instanceof ZoteroApiError) return error.message
  return error instanceof Error ? error.message : String(error)
}

export async function checkZoteroConnection(baseUrl: string): Promise<boolean> {
  try {
    await requestPage(baseUrl, 'users/0/items/top', 0, 1)
    return true
  } catch {
    return false
  }
}

export async function loadZoteroCollections(baseUrl: string): Promise<ZoteroCollection[]> {
  const collections = await loadPaginated(baseUrl, 'users/0/collections', parseCollection)
  return collections.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

export async function loadZoteroItems(baseUrl: string): Promise<ZoteroItem[]> {
  return loadPaginated(baseUrl, 'users/0/items/top?sort=dateModified&direction=desc', (value) =>
    parseItem(value, baseUrl),
  )
}

export async function loadZoteroItemDetails(baseUrl: string, itemKey: string): Promise<ZoteroItem> {
  const encodedKey = encodeURIComponent(itemKey)
  const { value } = await requestJson(baseUrl, `users/0/items/${encodedKey}`, { format: 'json' })
  const item = parseItem(value, baseUrl)
  if (!item) throw new ZoteroApiError('无法识别该 Zotero 条目')
  if (item.attachmentUrl) return item
  if (readNumber(asRecord(asRecord(value)?.meta)?.numChildren) === 0) return item

  const children = await loadPaginated(
    baseUrl,
    `users/0/items/${encodedKey}/children`,
    (child) => parseChildAttachment(child, baseUrl),
  )
  children.sort((left, right) => Number(right.isPdf) - Number(left.isPdf))
  return children[0] ? { ...item, attachmentUrl: children[0].url } : item
}

export async function openZoteroItem(itemKey: string): Promise<void> {
  await openUrl(`zotero://select/library/items/${encodeURIComponent(itemKey)}`)
}

export async function openZoteroLink(url: string): Promise<void> {
  const parsed = new URL(url)
  if (!['http:', 'https:', 'file:', 'zotero:'].includes(parsed.protocol)) {
    throw new Error('不支持打开此链接')
  }
  await openUrl(parsed.toString())
}
