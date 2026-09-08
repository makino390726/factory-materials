/**
 * 製作指図書PDF（D令）から指令名・図面パーツ・購入品を組み立てる。
 */

import {
  cellText,
  classifyKind,
  compactCell,
  normalizeDrawingNo,
  parseMaterialToken,
  type Ec25CoverMeta,
  type Ec25ParsedPart,
  type Ec25QtyUnit,
} from '@/lib/ec25-drawing-bom'

export type DorderOcrBox = {
  id?: string
  text: string
  conf?: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export type DorderOcrPage = {
  page: number
  page_kind?: string
  drawing_no?: string
  part_name?: string
  model_name?: string
  material?: string
  drawings?: string[]
  ocr?: string
  header_ocr?: string
  boxes?: DorderOcrBox[]
  width?: number
}

export type DorderAiPart = {
  part_key?: string
  part_name: string
  material?: string
  qty?: number
  unit?: string
  unit_price?: number | null
  supplier?: string
  category?: string
  note?: string
  source?: 'purchased' | 'quote' | 'detail' | 'drawing'
  page?: number
}

export type DorderAiExtract = {
  order_no?: string
  product_name?: string
  model?: string
  qty?: number
  parts?: DorderAiPart[]
}

export type DorderIndexPayload = {
  pages?: DorderOcrPage[]
  drawings?: Record<string, number[]>
  doc_pages?: number[]
  doc_type?: string
  rendered?: { page: number; path: string; width?: number; height?: number; title_path?: string }[]
}

function fold(s: string): string {
  return compactCell(s).toLowerCase()
}

function qtyUnit(raw: string | undefined): Ec25QtyUnit {
  const t = String(raw || '').toLowerCase()
  if (t === 'm' || t.includes('ｍ')) return 'm'
  if (t === 'm2' || t.includes('㎡')) return 'm2'
  if (t.includes('式') || t.includes('set')) return 'set'
  return 'pcs'
}

function looksLikeHeader(name: string): boolean {
  const t = compactCell(name)
  return /^(分類|型式|部品名称|部品名|品名|規格|個数|購入先|備考|図番)$/.test(t)
}

export function isDorderDocument(index: DorderIndexPayload): boolean {
  const kinds = (index.pages || []).map((p) => String(p.page_kind || ''))
  return kinds.some((k) => k === 'sashizu' || k === 'detail' || k === 'quote' || k === 'purchase_list')
}

function makePart(input: {
  sheet: string
  drawing: string
  name: string
  material: string
  qty: number
  unit: Ec25QtyUnit
  note: string
  source: NonNullable<Ec25ParsedPart['source']>
  supplier?: string
  quoted?: number | null
}): Ec25ParsedPart {
  const kind = classifyKind(input.name, input.material, input.drawing, input.sheet)
  const key = normalizeDrawingNo(input.drawing) || input.drawing || `BUY-${compactCell(input.name).slice(0, 24) || 'ITEM'}`
  return {
    sheet: input.sheet,
    size: '',
    drawing_no: normalizeDrawingNo(input.drawing),
    drawing_raw: input.drawing,
    part_key: key,
    part_name: input.name,
    material_raw: input.material,
    materials: input.material ? [parseMaterialToken(input.material)] : [],
    fasteners: [],
    qty_generator: input.qty,
    qty_chamber: 0,
    qty_pieces: input.qty || 1,
    qty_unit: input.unit,
    qty_raw: String(input.qty || ''),
    note: input.note,
    kind: input.source === 'purchased' || input.source === 'quote' ? 'purchased' : kind,
    include: (input.source === 'purchased' || input.source === 'quote' ? 'purchased' : kind) !== 'assembly',
    unfoldable: kind === 'sheet' || kind === 'profile',
    quoted_unit_price: input.quoted && input.quoted > 0 ? input.quoted : null,
    supplier: input.supplier || '',
    source: input.source,
  }
}

export function partsFromDrawingPages(pages: DorderOcrPage[]): Ec25ParsedPart[] {
  const out: Ec25ParsedPart[] = []
  for (const p of pages) {
    if (String(p.page_kind || '') !== 'drawing') continue
    const drawing = cellText(p.drawing_no)
    const name = cellText(p.part_name)
    if (!drawing && !name) continue
    if (name && looksLikeHeader(name)) continue
    out.push(
      makePart({
        sheet: `図面 p.${p.page}`,
        drawing,
        name: name || drawing,
        material: cellText(p.material),
        qty: 1,
        unit: 'pcs',
        note: cellText(p.ocr).slice(0, 180),
        source: 'drawing',
      })
    )
  }
  return out
}

export function partsFromAiExtract(ai: DorderAiExtract): Ec25ParsedPart[] {
  const out: Ec25ParsedPart[] = []
  for (const row of ai.parts || []) {
    const name = cellText(row.part_name || row.category)
    if (!name || looksLikeHeader(name)) continue
    const source = row.source === 'drawing' ? 'drawing' : row.source === 'quote' ? 'quote' : row.source === 'detail' ? 'detail' : 'purchased'
    const drawing = cellText(row.part_key)
    const material = cellText(row.material)
    const supplier = cellText(row.supplier)
    const noteParts = [
      supplier ? `購入先:${supplier}` : '',
      row.category && row.category !== name ? `分類:${row.category}` : '',
      cellText(row.note),
    ].filter(Boolean)
    const qty = Number(row.qty)
    out.push(
      makePart({
        sheet: source === 'quote' ? `見積 p.${row.page || ''}` : source === 'detail' ? `詳細表 p.${row.page || ''}` : `購入部品表 p.${row.page || ''}`,
        drawing,
        name,
        material,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        unit: qtyUnit(row.unit),
        note: noteParts.join(' / '),
        source: source === 'drawing' ? 'drawing' : source === 'quote' ? 'quote' : source === 'detail' ? 'detail' : 'purchased',
        supplier,
        quoted: Number(row.unit_price || 0) || null,
      })
    )
  }
  return out
}

function sameItem(a: Ec25ParsedPart, b: Ec25ParsedPart): boolean {
  const ak = fold(a.drawing_no || a.part_key)
  const bk = fold(b.drawing_no || b.part_key)
  if (ak && bk && ak === bk && !ak.startsWith('buy-')) return true
  const an = fold(a.part_name)
  const bn = fold(b.part_name)
  return Boolean(an && bn && (an === bn || an.includes(bn) || bn.includes(an)))
}

function mergeTwo(base: Ec25ParsedPart, extra: Ec25ParsedPart): Ec25ParsedPart {
  const drawing = base.drawing_no || extra.drawing_no
  const material = base.material_raw || extra.material_raw
  const supplier = base.supplier || extra.supplier
  const quoted = Number(base.quoted_unit_price || extra.quoted_unit_price || 0) || null
  const notes = [base.note, extra.note].filter(Boolean).join(' / ')
  const source =
    base.source === 'drawing' || extra.source === 'drawing'
      ? 'drawing'
      : extra.source === 'purchased' || base.source === 'purchased'
        ? 'purchased'
        : base.source
  const kind = source === 'purchased' && !drawing ? 'purchased' : classifyKind(base.part_name, material, drawing, base.sheet)
  return {
    ...base,
    drawing_no: drawing,
    drawing_raw: drawing || base.drawing_raw,
    part_key: drawing || base.part_key,
    material_raw: material,
    materials: material ? [parseMaterialToken(material)] : base.materials,
    qty_pieces: Math.max(base.qty_pieces, extra.qty_pieces) || 1,
    note: notes.slice(0, 400),
    supplier,
    quoted_unit_price: quoted,
    source,
    kind,
    include: kind !== 'assembly',
    unfoldable: kind === 'sheet' || kind === 'profile',
  }
}

export function mergeDorderParts(drawings: Ec25ParsedPart[], aiParts: Ec25ParsedPart[]): Ec25ParsedPart[] {
  const out = [...drawings]
  for (const extra of aiParts) {
    const idx = out.findIndex((p) => sameItem(p, extra))
    if (idx >= 0) {
      out[idx] = mergeTwo(out[idx], extra)
      continue
    }
    out.push(extra)
  }
  const seen = new Map<string, number>()
  return out.map((p) => {
    const n = (seen.get(p.part_key) || 0) + 1
    seen.set(p.part_key, n)
    return n === 1 ? p : { ...p, part_key: `${p.part_key}#${n}` }
  })
}

export function coverFromDorder(ai: DorderAiExtract, pages: DorderOcrPage[]): Ec25CoverMeta {
  const modelFromDrawings = pages.find((p) => p.model_name)?.model_name || ''
  const product = cellText(ai.product_name || ai.model || modelFromDrawings)
  const orderNo = cellText(ai.order_no).replace(/^D/, '')
  return {
    product_name: product,
    model_type: cellText(ai.model) || product,
    created_on: '',
    owner: '',
    order_no: orderNo ? (orderNo.startsWith('令') ? orderNo : `令${orderNo}`) : '',
  }
}

export const DORDER_AI_SYSTEM = `あなたは製作指図書・購入部品表・見積書を読む原価担当です。
スキャン画像から JSON だけを返します。

必ず抽出:
- 指令名/品名 → product_name（機種名。例: 葉もぎ機）
- 指令番号 → order_no（例: 令8-164）
- 購入品は 購入部品表・詳細表の購入部品・見積明細の全行を parts に入れる（空行・見出しは除外）
- 図面タイトル欄があれば 図番=part_key、品名=part_name、材質=material

購入品の規則:
- source は "purchased"（購入部品表）、"quote"（見積）、"detail"（製作内容詳細表）
- part_key は 型式または図番。無ければ空文字
- part_name は 部品名称。空なら 分類名
- material は 規格・材質
- qty / unit / unit_price（見積にあれば）/ supplier（購入先）
- 1行1部品。カット装置・タイヤ・蝶番など表の全データ行を落とさない`

export function dorderAiUserPrompt(pageLabels: string[]): string {
  return [
    `対象ページ: ${pageLabels.join(', ')}`,
    '次の JSON だけを返してください。',
    '{',
    '  "order_no": "",',
    '  "product_name": "",',
    '  "model": "",',
    '  "qty": 1,',
    '  "parts": [',
    '    {',
    '      "part_key": "",',
    '      "part_name": "",',
    '      "material": "",',
    '      "qty": 1,',
    '      "unit": "個",',
    '      "unit_price": null,',
    '      "supplier": "",',
    '      "category": "",',
    '      "note": "",',
    '      "source": "purchased",',
    '      "page": 1',
    '    }',
    '  ]',
    '}',
  ].join('\n')
}

export function mergeAiExtracts(chunks: DorderAiExtract[]): DorderAiExtract {
  const parts: DorderAiPart[] = []
  const out: DorderAiExtract = { parts }
  for (const chunk of chunks) {
    if (!out.order_no && chunk.order_no) out.order_no = chunk.order_no
    if (!out.product_name && chunk.product_name) out.product_name = chunk.product_name
    if (!out.model && chunk.model) out.model = chunk.model
    if (!out.qty && chunk.qty) out.qty = chunk.qty
    parts.push(...(chunk.parts || []))
  }
  return out
}
