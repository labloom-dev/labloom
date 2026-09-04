export interface ArxivQueryInput {
  categories: string
  keywords?: string
  author?: string
  maxResults: number
}

function splitCategories(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((category) => category.trim())
    .filter(Boolean)
}

function queryTerm(prefix: 'all' | 'au', value: string): string {
  const normalized = value.trim().replace(/"/g, '')
  return normalized.includes(' ') ? `${prefix}:"${normalized}"` : `${prefix}:${normalized}`
}

export function buildArxivUrl(input: ArxivQueryInput): string {
  const categories = splitCategories(input.categories)
  const terms: string[] = []
  if (categories.length === 1) terms.push(`cat:${categories[0]}`)
  if (categories.length > 1) terms.push(`(${categories.map((category) => `cat:${category}`).join(' OR ')})`)
  if (input.keywords?.trim()) terms.push(queryTerm('all', input.keywords))
  if (input.author?.trim()) terms.push(queryTerm('au', input.author))
  if (!terms.length) throw new Error('请至少填写分类、关键词或作者')

  const maxResults = Math.min(100, Math.max(1, Math.round(input.maxResults) || 50))
  return `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(terms.join(' AND '))}&start=0&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`
}
