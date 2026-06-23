/** 数値のみの商品コードから先頭00を除去（0084007700 → 84007700） */
export function canonicalizeProductCode(code: string): string {
  const trimmed = String(code || '').trim()
  if (!trimmed) return ''
  if (/^\d+$/.test(trimmed) && trimmed.startsWith('00') && trimmed.length > 2) {
    return trimmed.slice(2)
  }
  return trimmed
}

/** Excel 等から読み込んだ商品コードを文字列に正規化 */
export function normalizeProductCodeFromExcel(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  let basic = ''
  if (typeof raw === 'number') {
    if (Number.isFinite(raw) && Number.isInteger(raw)) {
      basic = String(raw)
    } else {
      basic = String(raw).trim()
    }
  } else {
    basic = String(raw).trim()
  }
  return canonicalizeProductCode(basic)
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
  const canonical = canonicalizeProductCode(trimmed)
  if (canonical !== trimmed) {
    patterns.push(canonical)
  }
  return patterns
}

function preferCanonicalProductCode(a: string, b: string): string {
  const ca = canonicalizeProductCode(a)
  const cb = canonicalizeProductCode(b)
  if (ca === cb) return ca
  if (ca.length <= cb.length) return ca
  return cb
}

/** 既存商品コードの検索用マップ（インポート値 → DB上の正規コード） */
export function buildProductCodeLookupMap(codes: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of codes) {
    const code = String(raw || '').trim()
    if (!code) continue
    const canonical = canonicalizeProductCode(code)
    for (const pattern of productCodePatterns(code)) {
      const prev = map.get(pattern)
      map.set(pattern, prev ? preferCanonicalProductCode(prev, canonical) : canonical)
    }
  }
  return map
}

/** マップへ商品コードを登録（新規作成後に呼ぶ） */
export function registerProductCode(map: Map<string, string>, code: string) {
  const canonical = canonicalizeProductCode(String(code || '').trim())
  if (!canonical) return
  for (const pattern of productCodePatterns(canonical)) {
    const prev = map.get(pattern)
    map.set(pattern, prev ? preferCanonicalProductCode(prev, canonical) : canonical)
  }
}

/** インポート値を DB 上の既存コードに解決。未登録なら正規化したコードを返す */
export function resolveProductCode(
  importCode: string,
  lookupMap: Map<string, string>
): { code: string; isExisting: boolean } {
  const trimmed = importCode.trim()
  if (!trimmed) return { code: '', isExisting: false }

  const canonical = canonicalizeProductCode(trimmed)

  for (const candidate of [canonical, trimmed]) {
    for (const pattern of productCodePatterns(candidate)) {
      if (lookupMap.has(pattern)) {
        const resolved = canonicalizeProductCode(lookupMap.get(pattern)!)
        return { code: resolved, isExisting: true }
      }
    }
  }

  return { code: canonical, isExisting: false }
}
