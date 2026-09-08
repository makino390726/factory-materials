/**
 * PDFタイトルブロック照合。
 * 図番 → パーツキー、品名上段 → パーツ名、品名下段 → 機種名。
 * Excel の SK10-1512-1 と PDF の SK10-1512-△1 を同一視する。
 */

export type Ec25PdfPageHit = {
  page: number
  drawing_no: string
  part_name: string
  model_name?: string
  ocr?: string
}

export type Ec25PdfIndex = {
  drawings?: Record<string, number[]>
  by_name?: Record<string, number[]>
  pages?: Ec25PdfPageHit[]
}

const OCR_CONFUSABLES: Record<string, string> = {
  町: '部',
  爆: '燥',
  様: '機',
  転: '乾',
  盆: '図',
  課: '面',
  飛: '産',
  麗: '州',
}

export function canonicalizeDrawingNo(raw: string): string {
  let s = String(raw ?? '')
    .toUpperCase()
    .replace(/\u3000/g, '')
    .replace(/\s+/g, '')
  if (!s || s === '〃') return ''
  s = s.replace(/[一–—ー]/g, '-')
  s = s
    .replace(/SKIO/g, 'SK10')
    .replace(/SK1O/g, 'SK10')
    .replace(/SKI0/g, 'SK10')
    .replace(/SKL0/g, 'SK10')
  s = s.replace(/[#＃]\d+$/g, '')
  s = s.replace(/[-]?(?:△|▲|Δ|∆|▽)\s*(\d+)/g, '-$1')
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s
}

export function drawingFamily(raw: string): string {
  const c = canonicalizeDrawingNo(raw)
  if (!c) return ''
  const parts = c.split('-')
  if (parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1] || '')) {
    return parts.slice(0, -1).join('-')
  }
  return c
}

export function asPdfIndex(value: Record<string, number[]> | Ec25PdfIndex | null | undefined): Ec25PdfIndex {
  if (!value) return { drawings: {}, pages: [] }
  if ('drawings' in value || 'pages' in value || 'by_name' in value) {
    const idx = value as Ec25PdfIndex
    return {
      drawings: idx.drawings || {},
      by_name: idx.by_name || {},
      pages: idx.pages || [],
    }
  }
  return { drawings: value as Record<string, number[]>, pages: [] }
}

function uniquePages(pages: number[]): number[] {
  return [...new Set(pages.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
}

function compactName(raw: string): string {
  return String(raw ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[()（）・,，、]/g, '')
}

function foldOcrName(raw: string): string {
  return [...compactName(raw)]
    .map((ch) => OCR_CONFUSABLES[ch] || ch)
    .join('')
    .replace(/せ切/g, '仕切')
    .replace(/乾爆/g, '乾燥')
    .replace(/火固定/g, '火炉固定')
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1)
    row[0] = i
    return row
  })
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

export function partNameScore(excelName: string, ocrName: string): number {
  const a = compactName(excelName)
  const b = compactName(ocrName)
  if (!a || !b || a.length < 2 || b.length < 2) return 0
  const variants = [b, foldOcrName(ocrName)]
  let best = 0
  for (const v of variants) {
    if (!v) continue
    if (a === v) return 1
    if (a.includes(v) || v.includes(a)) best = Math.max(best, 0.92)
    const d = levenshtein(a, v)
    best = Math.max(best, 1 - d / Math.max(a.length, v.length))
  }
  return best
}

export function lookupPdfPages(
  drawingNo: string,
  partKey: string,
  partName: string,
  index: Record<string, number[]> | Ec25PdfIndex | null | undefined
): number[] {
  const idx = asPdfIndex(index)
  const drawings = idx.drawings || {}
  const pages = idx.pages || []
  const wanted = [drawingNo, partKey].map(canonicalizeDrawingNo).filter(Boolean)
  const families = [...new Set(wanted.map(drawingFamily).filter(Boolean))]

  const fromMap = (pred: (key: string) => boolean): number[] => {
    const out: number[] = []
    for (const [key, nums] of Object.entries(drawings)) {
      if (pred(key)) out.push(...(nums || []))
    }
    return uniquePages(out)
  }

  const exact = fromMap((key) => wanted.includes(canonicalizeDrawingNo(key)))
  if (exact.length) return exact

  const pageExact = uniquePages(
    pages.filter((p) => wanted.includes(canonicalizeDrawingNo(p.drawing_no))).map((p) => p.page)
  )
  if (pageExact.length) return pageExact

  const familyKeys = Object.keys(drawings).filter((key) => families.includes(drawingFamily(key)))
  const familyPages = fromMap((key) => families.includes(drawingFamily(key)))
  if (familyKeys.length === 1 && familyPages.length) return familyPages
  const familyPageHits = pages.filter((p) => families.includes(drawingFamily(p.drawing_no)))
  const uniqueFamilyDrawings = new Set(familyPageHits.map((p) => canonicalizeDrawingNo(p.drawing_no)))
  if (uniqueFamilyDrawings.size === 1 && familyPageHits.length) {
    return uniquePages(familyPageHits.map((p) => p.page))
  }
  if (familyPages.length === 1) return familyPages

  if (partName) {
    const scored = pages
      .map((p) => ({ p, s: partNameScore(partName, p.part_name || '') }))
      .filter((x) => x.s >= 0.72)
      .sort((a, b) => b.s - a.s)
    if (scored.length) {
      const fam = scored.filter((x) => families.includes(drawingFamily(x.p.drawing_no)))
      const pick = fam.length ? fam : scored
      const top = pick[0].s
      return uniquePages(pick.filter((x) => x.s >= top - 0.02).map((x) => x.p.page))
    }
    const byName = idx.by_name || {}
    const nameHits: number[] = []
    for (const [name, nums] of Object.entries(byName)) {
      if (partNameScore(partName, name) >= 0.72) nameHits.push(...(nums || []))
    }
    const named = uniquePages(nameHits)
    if (named.length) return named
  }

  return []
}

export function missingDrawingMessage(drawingNo: string, partName: string): string {
  const bits = [drawingNo, partName].filter(Boolean).join(' / ')
  return bits
    ? `PDFの図番・品名と一致しません（${bits}）`
    : 'PDF上に図面番号が見つかりません'
}
