import { json2csv } from 'csv42'
import type { Deadline } from '../../types'
import {
  createDeadline,
  deadlineKey,
  DeadlineValidationError,
  type DeadlineImportIssue,
  type ParsedDeadlineImport,
} from './deadline'

export const DEADLINE_CSV_HEADERS = [
  'title',
  'type',
  'deadlineAt',
  'timezoneLabel',
  'url',
  'note',
] as const

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"') {
      if (field) throw new Error('引号字段格式无效')
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('引号字段没有闭合')
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function validationMessage(error: unknown): string {
  if (error instanceof DeadlineValidationError) return Object.values(error.fields).join('；')
  return error instanceof Error ? error.message : String(error)
}

export function importDeadlineCsv(source: string, existing: Deadline[] = []): ParsedDeadlineImport {
  const issues: DeadlineImportIssue[] = []
  const cleanSource = source.replace(/^\uFEFF/, '')
  let records: string[][]
  try {
    records = parseCsvRows(cleanSource)
  } catch (error) {
    return { deadlines: [], skipped: 0, issues: [{ message: `CSV 解析失败：${validationMessage(error)}` }] }
  }

  const header = records.shift()
  if (!header) return { deadlines: [], skipped: 0, issues: [{ row: 1, message: 'CSV 文件为空' }] }
  if (header.length !== DEADLINE_CSV_HEADERS.length || header.some((value, index) => value !== DEADLINE_CSV_HEADERS[index])) {
    return {
      deadlines: [],
      skipped: 0,
      issues: [{ row: 1, message: `表头必须严格为 ${DEADLINE_CSV_HEADERS.join(',')}` }],
    }
  }

  const keys = new Set(existing.map(deadlineKey))
  const deadlines: Deadline[] = []
  let skipped = 0
  for (const [index, values] of records.entries()) {
    const row = index + 2
    if (!values.some((value) => value.trim())) continue
    if (values.length !== DEADLINE_CSV_HEADERS.length) {
      issues.push({ row, title: values[0]?.trim() || undefined, message: '每条记录必须恰好包含 6 列' })
      continue
    }

    try {
      const deadline = createDeadline(
        {
          title: values[0],
          type: values[1],
          deadlineAt: values[2],
          timezoneLabel: values[3],
          url: values[4],
          note: values[5],
        },
        'csv',
      )
      const key = deadlineKey(deadline)
      if (keys.has(key)) {
        skipped += 1
        continue
      }
      keys.add(key)
      deadlines.push(deadline)
    } catch (error) {
      issues.push({ row, title: values[0].trim() || undefined, message: validationMessage(error) })
    }
  }

  return { deadlines, issues, skipped }
}

export function exportDeadlineCsv(deadlines: Deadline[]): string {
  const rows = deadlines.map((deadline) => ({
    title: deadline.title,
    type: deadline.type,
    deadlineAt: deadline.deadlineAt,
    timezoneLabel: deadline.timezoneLabel,
    url: deadline.url ?? '',
    note: deadline.note ?? '',
  }))
  return json2csv(rows, {
    eol: '\r\n',
    fields: DEADLINE_CSV_HEADERS.map((name) => ({ name, getValue: (row) => row[name] })),
  })
}
