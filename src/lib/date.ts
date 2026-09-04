export function parseDateTimestamp(value?: string): number | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

export function formatDateTime(value?: number | string, fallback = '时间未知'): string {
  if (value === undefined || value === '') return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatOffsetDateTime(value: string, fallback = '时间未知'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return fallback
  const wallClock = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ))
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(wallClock)
}

export function formatRelativeDate(value?: number, now = Date.now()): string {
  if (!value) return '时间未知'
  const diff = value - now
  const abs = Math.abs(diff)
  if (abs < 60_000) return '刚刚'
  if (abs < 3_600_000) {
    const minutes = Math.round(abs / 60_000)
    return diff < 0 ? `${minutes} 分钟前` : `${minutes} 分钟后`
  }
  if (abs < 86_400_000) {
    const hours = Math.round(abs / 3_600_000)
    return diff < 0 ? `${hours} 小时前` : `${hours} 小时后`
  }
  const days = Math.ceil(abs / 86_400_000)
  return diff < 0 ? `${days} 天前` : `${days} 天后`
}

export function remainingDays(deadlineAt: string, now = Date.now()): string {
  const timestamp = Date.parse(deadlineAt)
  if (Number.isNaN(timestamp)) return '日期无效'
  const diff = timestamp - now
  if (Math.abs(diff) < 86_400_000) return diff < 0 ? '刚刚过期' : '不足 1 天'
  const days = Math.ceil(Math.abs(diff) / 86_400_000)
  if (diff < 0) return `已过期 ${days} 天`
  return `剩余 ${days} 天`
}
