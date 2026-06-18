/** Excel 等から読み込んだ商品コードを文字列に正規化 */
export function normalizeProductCodeFromExcel(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'number') {
    if (Number.isFinite(raw) && Number.isInteger(raw)) return String(raw)
    return String(raw).trim()
  }
  return String(raw).trim()
}

const productCodePatterns = (code: string): string[] => {
  const trimmed = code.trim()
  if (!trimmed) return []
  const patterns = [
    trimmed,
    trimmed.toUpperCase(),
    trimmed.toLowerCase(),
    trimmed.replace(/-/g, ''),
  ]
  const num = parseInt(trimmed, 10)
  if (!Number.isNaN(num)) {
    patterns.push(String(num))
  }
  return patterns
}

/** 既存商品コードの検索用マップ（インポート値 → DB上の正規コード） */
export function buildProductCodeLookupMap(codes: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of codes) {
    const code = String(raw || '').trim()
    if (!code) continue
    for (const pattern of productCodePatterns(code)) {
      if (!map.has(pattern)) map.set(pattern, code)
    }
  }
  return map
}

/** マップへ商品コードを登録（新規作成後に呼ぶ） */
export function registerProductCode(map: Map<string, string>, code: string) {
  const trimmed = String(code || '').trim()
  if (!trimmed) return
  for (const pattern of productCodePatterns(trimmed)) {
    if (!map.has(pattern)) map.set(pattern, trimmed)
  }
}

/** インポート値を DB 上の既存コードに解決。未登録ならそのまま返す */
export function resolveProductCode(
  importCode: string,
  lookupMap: Map<string, string>
): { code: string; isExisting: boolean } {
  const trimmed = importCode.trim()
  if (!trimmed) return { code: '', isExisting: false }

  for (const pattern of productCodePatterns(trimmed)) {
    if (lookupMap.has(pattern)) {
      return { code: lookupMap.get(pattern)!, isExisting: true }
    }
  }

  return { code: trimmed, isExisting: false }
}
