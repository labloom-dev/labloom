import { parseFeed } from 'feedsmith'
import { persistDeadlines } from '../../app/persistence'
import { appState } from '../../app/state.svelte'
import { fetchText } from '../../lib/http'
import type { Deadline } from '../../types'

export interface DeadlineDraft {
  title: string
  type: string
  deadlineAt: string
  timezoneLabel: string
  url?: string
  note?: string
}

export type NormalizedDeadlineDraft = Omit<Deadline, 'id' | 'source'>

export interface DeadlineImportIssue {
  row?: number
  title?: string
  message: string
}

export interface ParsedDeadlineImport {
  deadlines: Deadline[]
  issues: DeadlineImportIssue[]
  skipped: number
}

export class DeadlineValidationError extends Error {
  fields: Partial<Record<keyof DeadlineDraft, string>>

  constructor(fields: Partial<Record<keyof DeadlineDraft, string>>) {
    super(Object.values(fields)[0] ?? '截止日期数据无效')
    this.name = 'DeadlineValidationError'
    this.fields = fields
  }
}

const OFFSET_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/i
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

function isAoe(label: string): boolean {
  return label.trim().toLowerCase() === 'aoe'
}

function validCalendarParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (year < 1000 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= lastDay
}

export function normalizeUtcOffset(value: string): string | null {
  const source = value.trim()
  if (/^(?:Z|UTC)$/i.test(source)) return '+00:00'
  const trimmed = source.replace(/^UTC(?=[+-])/i, '')
  const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(trimmed)
  if (!match) return null
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null
  return `${match[1]}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function normalizeOffsetIso(value: string): string | null {
  const match = OFFSET_ISO_PATTERN.exec(value.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? '0')
  if (!validCalendarParts(year, month, day, hour, minute, second)) return null

  let offset = '+00:00'
  if (match[8].toUpperCase() !== 'Z') {
    const offsetHours = Number(match[10])
    const offsetMinutes = Number(match[11])
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null
    offset = `${match[9]}${match[10]}:${match[11]}`
  }

  const milliseconds = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0
  const fraction = milliseconds ? `.${String(milliseconds).padStart(3, '0')}` : ''
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${String(second).padStart(2, '0')}${fraction}${offset}`
  return Number.isNaN(Date.parse(canonical)) ? null : canonical
}

export function offsetFromDeadlineAt(deadlineAt: string): string {
  return normalizeOffsetIso(deadlineAt)?.slice(-6) ?? '+00:00'
}

export function localDateTimeFromDeadlineAt(deadlineAt: string): string {
  return normalizeOffsetIso(deadlineAt)?.slice(0, 16) ?? ''
}

export function timezoneLabelFor(deadlineAt: string): string {
  const offset = offsetFromDeadlineAt(deadlineAt)
  if (offset === '-12:00') return 'AoE'
  if (offset === '+00:00') return 'UTC'
  return `UTC${offset}`
}

export function buildDeadlineAt(localDateTime: string, utcOffset: string, timezoneLabel: string): string {
  const local = localDateTime.trim().replace(' ', 'T')
  if (!LOCAL_DATE_TIME_PATTERN.test(local)) {
    throw new DeadlineValidationError({ deadlineAt: '请选择有效的截止日期和时间' })
  }
  const offset = isAoe(timezoneLabel) ? '-12:00' : normalizeUtcOffset(utcOffset)
  if (!offset) throw new DeadlineValidationError({ deadlineAt: 'UTC 偏移格式应为 +08:00 或 -12:00' })
  const normalized = normalizeOffsetIso(`${local}${offset}`)
  if (!normalized) throw new DeadlineValidationError({ deadlineAt: '截止日期或 UTC 偏移无效' })
  return normalized
}

export function normalizeHttpUrl(value: string, base?: string): string {
  const parsed = base ? new URL(value, base) : new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 地址')
  return parsed.toString()
}

export function normalizeDeadlineDraft(input: DeadlineDraft): NormalizedDeadlineDraft {
  const fields: Partial<Record<keyof DeadlineDraft, string>> = {}
  const title = input.title.trim()
  if (!title) fields.title = '请填写标题'
  else if (title.length > 160) fields.title = '标题不能超过 160 个字符'
  if (!['conference', 'journal'].includes(input.type)) fields.type = '请选择会议或期刊类型'

  const deadlineAt = normalizeOffsetIso(input.deadlineAt)
  if (!deadlineAt) fields.deadlineAt = '截止日期必须是带明确 UTC 偏移的 ISO 时间'
  const timezoneLabel = input.timezoneLabel.trim() || (deadlineAt ? timezoneLabelFor(deadlineAt) : 'UTC')
  if (timezoneLabel.length > 40) fields.timezoneLabel = '时区标签不能超过 40 个字符'
  if (deadlineAt && isAoe(timezoneLabel) && !deadlineAt.endsWith('-12:00')) {
    fields.deadlineAt = 'AoE 截止时间必须使用 -12:00 偏移'
  }

  let url: string | undefined
  if (input.url?.trim()) {
    try {
      url = normalizeHttpUrl(input.url.trim())
    } catch (error) {
      fields.url = error instanceof Error ? error.message : '链接无效'
    }
  }

  if ((input.note?.trim().length ?? 0) > 2000) fields.note = '备注不能超过 2000 个字符'
  if (Object.keys(fields).length) throw new DeadlineValidationError(fields)
  return {
    title,
    type: input.type as Deadline['type'],
    deadlineAt: deadlineAt!,
    timezoneLabel,
    url,
    note: input.note?.trim() || undefined,
  }
}

export function createDeadline(
  input: DeadlineDraft,
  source: Deadline['source'],
  id: string = crypto.randomUUID(),
): Deadline {
  return { id, source, ...normalizeDeadlineDraft(input) }
}

export function deadlineKey(deadline: Pick<Deadline, 'title' | 'deadlineAt'>): string {
  const title = deadline.title.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  return `${title}\u0000${normalizeOffsetIso(deadline.deadlineAt) ?? deadline.deadlineAt.trim()}`
}

export function sortDeadlines(deadlines: Deadline[]): Deadline[] {
  return [...deadlines].sort((left, right) => {
    const leftTime = Date.parse(left.deadlineAt)
    const rightTime = Date.parse(right.deadlineAt)
    const byDate = (Number.isNaN(leftTime) ? Number.POSITIVE_INFINITY : leftTime)
      - (Number.isNaN(rightTime) ? Number.POSITIVE_INFINITY : rightTime)
    return byDate || left.title.localeCompare(right.title, 'zh-CN')
  })
}

export function uniqueDeadlines(
  existing: Deadline[],
  incoming: Deadline[],
): { added: Deadline[]; skipped: number } {
  const keys = new Set(existing.map(deadlineKey))
  const added: Deadline[] = []
  let skipped = 0
  for (const deadline of incoming) {
    const key = deadlineKey(deadline)
    if (keys.has(key)) {
      skipped += 1
      continue
    }
    keys.add(key)
    added.push(deadline)
  }
  return { added, skipped }
}

export async function addDeadline(input: DeadlineDraft): Promise<Deadline> {
  const deadline = createDeadline(input, 'manual')
  if (appState.deadlines.some((item) => deadlineKey(item) === deadlineKey(deadline))) {
    throw new Error('同名且同一截止时间的记录已存在')
  }
  const previous = appState.deadlines
  appState.deadlines = sortDeadlines([...appState.deadlines, deadline])
  try {
    await persistDeadlines()
  } catch (error) {
    appState.deadlines = previous
    throw error
  }
  return deadline
}

export async function updateDeadline(id: string, input: DeadlineDraft): Promise<Deadline> {
  const previous = appState.deadlines.find((item) => item.id === id)
  if (!previous) throw new Error('找不到要编辑的截止日期')
  const deadline = createDeadline(input, previous.source, id)
  if (appState.deadlines.some((item) => item.id !== id && deadlineKey(item) === deadlineKey(deadline))) {
    throw new Error('同名且同一截止时间的记录已存在')
  }
  const previousDeadlines = appState.deadlines
  appState.deadlines = sortDeadlines(appState.deadlines.map((item) => (item.id === id ? deadline : item)))
  try {
    await persistDeadlines()
  } catch (error) {
    appState.deadlines = previousDeadlines
    throw error
  }
  return deadline
}

export async function deleteDeadline(id: string): Promise<void> {
  if (!appState.deadlines.some((item) => item.id === id)) return
  const previous = appState.deadlines
  appState.deadlines = appState.deadlines.filter((item) => item.id !== id)
  try {
    await persistDeadlines()
  } catch (error) {
    appState.deadlines = previous
    throw error
  }
}

export async function appendImportedDeadlines(
  incoming: Deadline[],
): Promise<{ added: number; skipped: number }> {
  const result = uniqueDeadlines(appState.deadlines, incoming)
  if (result.added.length) {
    const previous = appState.deadlines
    appState.deadlines = sortDeadlines([...appState.deadlines, ...result.added])
    try {
      await persistDeadlines()
    } catch (error) {
      appState.deadlines = previous
      throw error
    }
  }
  return { added: result.added.length, skipped: result.skipped }
}

interface CcfCandidate {
  title?: string
  date?: string
  url?: string
}

function firstValue(values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim()
}

function ccfCandidates(source: string): CcfCandidate[] {
  const parsed = parseFeed(source)
  if (parsed.format === 'rss') {
    return (parsed.feed.items ?? []).map((item) => ({
      title: firstValue([item.title, item.dc?.titles?.[0]]),
      date: firstValue([item.pubDate, item.atom?.published, item.atom?.updated, item.dc?.dates?.[0]]),
      url: firstValue([
        item.link,
        item.atom?.links?.find((link) => link.rel === 'alternate' || !link.rel)?.href,
      ]),
    }))
  }
  if (parsed.format === 'atom') {
    return (parsed.feed.entries ?? []).map((entry) => ({
      title: entry.title,
      date: firstValue([entry.published, entry.updated]),
      url: firstValue([
        entry.links?.find((link) => link.rel === 'alternate' || !link.rel)?.href,
        entry.links?.[0]?.href,
      ]),
    }))
  }
  if (parsed.format === 'json') {
    return (parsed.feed.items ?? []).map((item) => ({
      title: item.title,
      date: firstValue([item.date_published, item.date_modified]),
      url: firstValue([item.url, item.external_url]),
    }))
  }
  return (parsed.feed.items ?? []).map((item) => ({
    title: firstValue([item.title, item.dc?.titles?.[0]]),
    date: firstValue([item.atom?.published, item.atom?.updated, item.dc?.dates?.[0]]),
    url: firstValue([item.link, item.atom?.links?.find((link) => link.rel === 'alternate' || !link.rel)?.href]),
  }))
}

export function normalizeReliableFeedDate(value: string): string | null {
  const direct = normalizeOffsetIso(value)
  if (direct) return direct

  const aoe = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)\s+AoE$/i.exec(value.trim())
  if (aoe) {
    try {
      return buildDeadlineAt(aoe[1], '-12:00', 'AoE')
    } catch {
      return null
    }
  }


  const rfc822 = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+([+-])(\d{2})(\d{2})$/i.exec(value.trim())
  if (rfc822) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    }
    const month = months[rfc822[2].toLowerCase()]
    if (!month) return null
    return normalizeOffsetIso(
      `${rfc822[3]}-${month}-${rfc822[1].padStart(2, '0')}T${rfc822[4]}:${rfc822[5]}:${rfc822[6] ?? '00'}${rfc822[7]}${rfc822[8]}:${rfc822[9]}`,
    )
  }

  const hasExplicitZone = /(?:\b(?:GMT|UTC)\b|[+-]\d{2}:?\d{2})(?:\s*\([^)]*\))?$/i.test(value.trim())
  if (!hasExplicitZone) return null
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return null
  return normalizeOffsetIso(new Date(timestamp).toISOString())
}

export function parseCcfFeedDocument(
  source: string,
  feedUrl: string,
  existing: Deadline[] = [],
): ParsedDeadlineImport {
  const issues: DeadlineImportIssue[] = []
  const deadlines: Deadline[] = []
  const keys = new Set(existing.map(deadlineKey))
  let skipped = 0

  for (const [index, candidate] of ccfCandidates(source).entries()) {
    const row = index + 1
    const title = candidate.title?.trim()
    if (!title) {
      issues.push({ row, message: '条目缺少标题' })
      continue
    }
    if (!candidate.date) {
      issues.push({ row, title, message: '条目没有可用的日期字段' })
      continue
    }
    const deadlineAt = normalizeReliableFeedDate(candidate.date)
    if (!deadlineAt) {
      issues.push({ row, title, message: '日期无效或没有明确时区，未尝试从标题或正文猜测' })
      continue
    }

    let url: string | undefined
    if (candidate.url) {
      try {
        url = normalizeHttpUrl(candidate.url, feedUrl)
      } catch {
        issues.push({ row, title, message: '条目链接无效，已忽略链接' })
      }
    }

    const deadline = createDeadline(
      {
        title,
        type: 'conference',
        deadlineAt,
        timezoneLabel: timezoneLabelFor(deadlineAt),
        url,
      },
      'ccf',
    )
    const key = deadlineKey(deadline)
    if (keys.has(key)) {
      skipped += 1
      continue
    }
    keys.add(key)
    deadlines.push(deadline)
  }

  return { deadlines, issues, skipped }
}

export async function fetchCcfDeadlines(
  feedUrl: string,
  existing: Deadline[] = [],
): Promise<ParsedDeadlineImport> {
  const url = normalizeHttpUrl(feedUrl.trim())
  const { response, text } = await fetchText(url, {
    headers: { Accept: 'application/atom+xml, application/rss+xml, application/feed+json, text/xml, */*' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  if (!text.trim()) throw new Error('CCF RSS 响应内容为空')
  return parseCcfFeedDocument(text, url, existing)
}
