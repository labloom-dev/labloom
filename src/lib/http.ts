import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export async function fetchText(
  url: string,
  init?: RequestInit,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)
  const abort = () => controller.abort()
  init?.signal?.addEventListener('abort', abort, { once: true })

  try {
    const response = await tauriFetch(url, { ...init, signal: controller.signal })
    if (response.status === 304) return { response, text: '' }

    const maxBytes = options.maxBytes ?? 5 * 1024 * 1024
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`响应内容超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`)
    }
    const data = await response.arrayBuffer()
    if (data.byteLength > maxBytes) {
      throw new Error(`响应内容超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`)
    }

    const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(response.headers.get('content-type') ?? '')?.[1]
    let decoder: TextDecoder
    try {
      decoder = new TextDecoder(charset || 'utf-8')
    } catch {
      decoder = new TextDecoder('utf-8')
    }
    return { response, text: decoder.decode(data) }
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted) throw new Error('请求超时')
    throw error
  } finally {
    window.clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', abort)
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await tauriFetch(url, init)
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  return (await response.json()) as T
}
