/**
 * 材質名・部品名から製品マスタ（品名・規格・単価）を照合する。
 */

import { compactCell, type Ec25MaterialToken, type Ec25ParsedPart } from '@/lib/ec25-drawing-bom'
import { hasExcludedLeading00 } from '@/lib/product-code'

export type ProductCostRow = {
  product_code: string
  name: string
  spec?: string | null
  cost_price?: number | null
}

export type MaterialMatch = {
  product_code: string
  name: string
  spec: string
  cost_price: number
  score: number
  tier: 'exact' | 'partial'
}

function norm(s: string): string {
  return compactCell(s).toLowerCase()
}

function thicknessToken(mm: number | null): string {
  if (mm == null || !Number.isFinite(mm)) return ''
  const n = String(mm)
  const alt = Number.isInteger(mm) ? String(mm) : n
  return alt
}

function scoreProduct(p: ProductCostRow, hint: Ec25MaterialToken, partName: string): number {
  const hay = norm(`${p.name} ${p.spec || ''}`)
  if (!hay) return 0
  let score = 0

  if (hint.family) {
    const fam = norm(hint.family)
    if (hay.includes(fam)) score += 45
    else if (fam.length >= 2 && hay.includes(fam.slice(0, 3))) score += 15
  }

  if (hint.thickness_mm != null) {
    const t = thicknessToken(hint.thickness_mm)
    if (hay.includes(`t${t}`) || hay.includes(`t ${t}`) || hay.includes(`${t}mm`)) score += 30
    else if (new RegExp(`(?:^|[^0-9.])${t.replace('.', '\\.')}(?:$|[^0-9])`).test(hay) && hay.includes('t')) {
      score += 18
    }
  }

  if (hint.shape) {
    const shape = norm(hint.shape).replace(/[×x]/g, 'x')
    const hayShape = hay.replace(/[×x]/g, 'x')
    if (shape && hayShape.includes(shape)) score += 28
  }

  const partN = norm(partName)
  const nameN = norm(p.name)
  if (partN && nameN && (nameN === partN || nameN.includes(partN) || partN.includes(nameN))) {
    score += nameN === partN ? 50 : 22
  }

  const specN = norm(String(p.spec || ''))
  if (partN && specN && (specN === partN || specN.includes(partN) || partN.includes(specN))) {
    score += specN === partN ? 40 : 16
  }

  for (const kw of hint.keywords) {
    if (kw && hay.includes(kw)) score += 8
  }

  return score
}

export function matchProductsForHint(
  products: ProductCostRow[],
  hint: Ec25MaterialToken,
  partName: string,
  limit = 8
): MaterialMatch[] {
  const scored: MaterialMatch[] = []
  for (const p of products) {
    if (hasExcludedLeading00(p.product_code)) continue
    const score = scoreProduct(p, hint, partName)
    if (score < 20) continue
    scored.push({
      product_code: p.product_code,
      name: p.name,
      spec: String(p.spec || ''),
      cost_price: Number(p.cost_price || 0),
      score,
      tier: score >= 70 ? 'exact' : 'partial',
    })
  }
  scored.sort((a, b) => b.score - a.score || a.product_code.localeCompare(b.product_code))
  const uniq: MaterialMatch[] = []
  const seen = new Set<string>()
  for (const m of scored) {
    if (seen.has(m.product_code)) continue
    seen.add(m.product_code)
    uniq.push(m)
    if (uniq.length >= limit) break
  }
  return uniq
}

export function fuzzyScoreAgainstQuery(p: ProductCostRow, query: string): number {
  const hay = norm(`${p.product_code} ${p.name} ${p.spec || ''}`)
  const q = norm(query)
  if (!q || !hay) return 0
  const code = norm(p.product_code)
  if (code === q) return 200
  if (code.startsWith(q) || code.includes(q)) return 140
  if (hay.includes(q)) return 110
  const tokens = q.split(/[^a-z0-9.\-一-龥ぁ-んァ-ヶー]+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) {
    let i = 0
    let j = 0
    while (i < q.length && j < hay.length) {
      if (q[i] === hay[j]) i++
      j++
    }
    return i === q.length ? 25 : 0
  }
  let hit = 0
  let score = 0
  for (const t of tokens) {
    if (hay.includes(t)) {
      hit++
      score += Math.min(32, 10 + t.length * 2)
    }
  }
  if (!hit) return 0
  return score + Math.round((hit / tokens.length) * 40)
}

export type Ec25CostElement = {
  role: 'material' | 'fastener'
  quantity: number | null
  material_raw: string
  family: string
  product_code: string
  product_name: string
  spec: string
  unit_price: number
  candidates: MaterialMatch[]
  drawing_spec?: boolean
}

function fastenerSearchName(name: string): string {
  return name
    .replace(/[×xX]/g, '×')
    .replace(/(\d)B\b/g, '$1')
    .replace(/[()（）]/g, ' ')
    .trim()
}

export function buildCostElements(part: Ec25ParsedPart, products: ProductCostRow[]): Ec25CostElement[] {
  const out: Ec25CostElement[] = []

  if (part.kind !== 'assembly') {
    const hints =
      part.materials.length > 0
        ? part.materials
        : [
            {
              raw: part.material_raw || part.part_name,
              family: '',
              thickness_mm: null,
              shape: '',
              keywords: [],
            } satisfies Ec25MaterialToken,
          ]

    for (let i = 0; i < hints.length; i++) {
      const hint = hints[i]
      const isSpec = hint.drawing_spec === true || (i === 0 && hint.drawing_spec !== false)
      const queryHint =
        part.kind === 'purchased'
          ? { ...hint, raw: part.part_name, keywords: [...hint.keywords, norm(part.part_name)].filter(Boolean) }
          : hint
      const candidates = matchProductsForHint(products, queryHint, part.part_name)
      const top = candidates[0]
      const quoted = Number(part.quoted_unit_price || 0)
      out.push({
        role: 'material',
        drawing_spec: isSpec,
        quantity: isSpec ? null : hint.qty != null && hint.qty > 0 ? hint.qty : null,
        material_raw: hint.raw || part.material_raw,
        family: hint.family,
        product_code: top?.product_code || '',
        product_name: top?.name || (quoted > 0 ? part.part_name : ''),
        spec: top?.spec || (part.supplier ? `購入 ${part.supplier}` : ''),
        unit_price: top?.cost_price || quoted || 0,
        candidates,
      })
    }
  }

  for (const f of part.fasteners || []) {
    const search = fastenerSearchName(f.name)
    const size = search.match(/M\s*\d+(?:\.\d+)?\s*[×xX]\s*\d+/i)?.[0] || ''
    const hint: Ec25MaterialToken = {
      raw: f.name,
      family: '',
      thickness_mm: null,
      shape: size.replace(/\s+/g, ''),
      keywords: [norm(search), norm(size)].filter(Boolean),
    }
    const candidates = matchProductsForHint(products, hint, search)
    const top = candidates[0]
    out.push({
      role: 'fastener',
      quantity: f.qty,
      material_raw: f.name,
      family: '',
      product_code: top?.product_code || '',
      product_name: top?.name || '',
      spec: top?.spec || '',
      unit_price: top?.cost_price || 0,
      candidates,
    })
  }

  return out
}
