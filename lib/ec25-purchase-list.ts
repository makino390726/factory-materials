/**
 * 購入品一覧（Excel / PDFの購入部品表・見積）を図番管理表パーツへ変換する。
 */

import * as XLSX from 'xlsx'
import {
  cellText,
  compactCell,
  normalizeDrawingNo,
  parseMaterialToken,
  parseQtyExpression,
  type Ec25ParsedPart,
  type Ec25QtyUnit,
} from '@/lib/ec25-drawing-bom'
import { autoMapBoxes, partsFromMappedPages, type MappedPage, type OcrBox } from '@/lib/ec25-ocr-map'
import {
  partsFromAiExtract,
  type DorderAiExtract,
  type DorderAiPart,
  type DorderIndexPayload,
} from '@/lib/ec25-dorder-extract'

export type PurchaseListCol =
  | 'part_key'
  | 'part_name'
  | 'material'
  | 'qty'
  | 'unit'
  | 'supplier'
  | 'unit_price'
  | 'category'
  | 'note'

const HEADER_MAP: { key: PurchaseListCol; re: RegExp }[] = [
  { key: 'part_name', re: /^(部品名称|部品名|品名|名称|品目)$/ },
  { key: 'part_key', re: /^(型式|型番|品番|図番|図面番号|パーツキー)$/ },
  { key: 'material', re: /^(規格|材質|仕様|摘要)$/ },
  { key: 'qty', re: /^(個数|数量|員数|員數)$/ },
  { key: 'unit', re: /^(単位)$/ },
  { key: 'supplier', re: /^(購入先|仕入先|メーカ|メーカー|メーカー名|メーカー／購入先)$/ },
  { key: 'unit_price', re: /^(単価|見積単価|仕入単価)$/ },
  { key: 'category', re: /^(分類|区分|種別|種類)$/ },
  { key: 'note', re: /^(備考|注記|摘要欄)$/ },
]

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

function parsePrice(raw: unknown): number | null {
  const n = Number(String(raw ?? '').replace(/[,，円¥￥\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function looksLikeHeaderName(name: string): boolean {
  const t = compactCell(name)
  return /^(分類|型式|部品名称|部品名|品名|規格|個数|購入先|備考|図番|単価|金額|単位)$/.test(t)
}

function isDrawingMasterRow(labels: string[]): boolean {
  const blob = labels.join(' ')
  return /発生機/.test(blob) || /乾燥室/.test(blob) || /２．５坪|2.5坪/.test(blob)
}

function mapHeaderRow(row: unknown[]): Partial<Record<PurchaseListCol, number>> {
  const cols: Partial<Record<PurchaseListCol, number>> = {}
  for (let c = 0; c < row.length; c++) {
    const t = compactCell(row[c])
    if (!t) continue
    const hit = HEADER_MAP.find((h) => h.re.test(t))
    if (hit && cols[hit.key] == null) cols[hit.key] = c
  }
  return cols
}

function headerScore(cols: Partial<Record<PurchaseListCol, number>>): number {
  let n = 0
  for (const k of Object.keys(cols)) n += 1
  if (cols.part_name != null) n += 2
  if (cols.supplier != null || cols.unit_price != null) n += 2
  return n
}

function isPurchaseHeader(
  cols: Partial<Record<PurchaseListCol, number>>,
  sheetName: string,
  labels: string[]
): boolean {
  if (isDrawingMasterRow(labels)) return false
  if (!(cols.part_name != null || cols.part_key != null)) return false
  if (/購入|見積|purchase/i.test(sheetName)) return true
  if (cols.supplier != null || cols.unit_price != null) return headerScore(cols) >= 3
  return cols.part_name != null && cols.qty != null && headerScore(cols) >= 4
}

function findPurchaseHeader(
  matrix: unknown[][],
  sheetName: string
): { row: number; cols: Partial<Record<PurchaseListCol, number>> } | null {
  let best: { row: number; cols: Partial<Record<PurchaseListCol, number>>; score: number } | null = null
  for (let r = 0; r < Math.min(20, matrix.length); r++) {
    const row = matrix[r] || []
    const labels = row.map((c) => compactCell(c))
    const cols = mapHeaderRow(row)
    if (!isPurchaseHeader(cols, sheetName, labels)) continue
    const score = headerScore(cols)
    if (!best || score > best.score) best = { row: r, cols, score }
  }
  return best ? { row: best.row, cols: best.cols } : null
}

function makePurchasePart(input: {
  sheet: string
  drawing: string
  name: string
  material: string
  qty: number
  unit: Ec25QtyUnit
  note: string
  supplier?: string
  quoted?: number | null
  source?: Ec25ParsedPart['source']
}): Ec25ParsedPart {
  const name = cellText(input.name)
  const drawing = normalizeDrawingNo(input.drawing)
  const key = drawing || `BUY-${compactCell(name).slice(0, 24) || 'ITEM'}`
  const material = cellText(input.material)
  return {
    sheet: input.sheet,
    size: '',
    drawing_no: drawing,
    drawing_raw: input.drawing,
    part_key: key,
    part_name: name,
    material_raw: material,
    materials: material ? [parseMaterialToken(material)] : [],
    fasteners: [],
    qty_generator: input.qty,
    qty_chamber: 0,
    qty_pieces: input.qty > 0 ? input.qty : 1,
    qty_unit: input.unit,
    qty_raw: String(input.qty || ''),
    note: input.note,
    kind: 'purchased',
    include: true,
    unfoldable: false,
    quoted_unit_price: input.quoted && input.quoted > 0 ? input.quoted : null,
    supplier: input.supplier || '',
    source: input.source || 'purchased',
  }
}

function uniquify(parts: Ec25ParsedPart[]): Ec25ParsedPart[] {
  const seen = new Map<string, number>()
  return parts.map((p) => {
    const n = (seen.get(p.part_key) || 0) + 1
    seen.set(p.part_key, n)
    return n === 1 ? p : { ...p, part_key: `${p.part_key}#${n}` }
  })
}

export function parsePurchaseListSheet(sheetName: string, matrix: unknown[][]): Ec25ParsedPart[] {
  const header = findPurchaseHeader(matrix, sheetName)
  if (!header) return []
  const { cols } = header
  const out: Ec25ParsedPart[] = []
  let lastKey = ''
  let lastName = ''
  let lastMaterial = ''
  let lastQty = 0
  let lastSupplier = ''

  for (let r = header.row + 1; r < matrix.length; r++) {
    const row = matrix[r] || []
    const get = (k: PurchaseListCol) => (cols[k] != null ? cellText(row[cols[k] as number]) : '')
    const rawName = get('part_name')
    const rawKey = get('part_key')
    const rawMat = get('material')
    const rawSup = get('supplier')
    const qtyRaw = get('qty')
    if (!rawName && !rawKey && !qtyRaw && !rawMat) continue
    if (looksLikeHeaderName(rawName) || looksLikeHeaderName(rawKey)) continue
    if (/三州産業|株式会社/.test(compactCell(`${rawName}${rawKey}`))) continue

    const name = rawName === '〃' ? lastName : rawName || ''
    if (rawName && rawName !== '〃') lastName = rawName
    const keyRaw = rawKey === '〃' ? lastKey : rawKey || ''
    if (rawKey && rawKey !== '〃') lastKey = rawKey
    const material = rawMat === '〃' ? lastMaterial : rawMat || ''
    if (rawMat && rawMat !== '〃') lastMaterial = rawMat
    const supplier = rawSup === '〃' ? lastSupplier : rawSup || ''
    if (rawSup && rawSup !== '〃') lastSupplier = rawSup

    if (!name && !keyRaw) continue

    const parsedQty = parseQtyExpression(qtyRaw)
    const qty = parsedQty.ditto ? lastQty : parsedQty.qty
    if (!parsedQty.ditto) lastQty = qty
    const unit = get('unit') ? qtyUnit(get('unit')) : parsedQty.unit
    const category = get('category')
    const note = [category ? `分類:${category}` : '', get('note')].filter(Boolean).join(' / ')

    out.push(
      makePurchasePart({
        sheet: sheetName,
        drawing: keyRaw,
        name: name || keyRaw,
        material,
        qty,
        unit,
        note,
        supplier,
        quoted: parsePrice(get('unit_price')),
        source: /見積/.test(sheetName) ? 'quote' : 'purchased',
      })
    )
  }
  return out
}

export function parsePurchaseListExcel(buffer: Buffer): Ec25ParsedPart[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const parts: Ec25ParsedPart[] = []
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name]
    if (!sh) continue
    const matrix = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' }) as unknown[][]
    parts.push(...parsePurchaseListSheet(name, matrix))
  }
  return uniquify(parts)
}

export function samePurchaseItem(a: Ec25ParsedPart, b: Ec25ParsedPart): boolean {
  const ak = fold(normalizeDrawingNo(a.drawing_no || '') || (!String(a.part_key).startsWith('BUY-') ? a.part_key : ''))
  const bk = fold(normalizeDrawingNo(b.drawing_no || '') || (!String(b.part_key).startsWith('BUY-') ? b.part_key : ''))
  if (ak && bk && !ak.startsWith('buy-') && !bk.startsWith('buy-') && ak === bk) return true
  const an = fold(a.part_name)
  const bn = fold(b.part_name)
  return Boolean(an && bn && an === bn)
}

export function mergePurchaseIntoBase(base: Ec25ParsedPart, extra: Ec25ParsedPart): Ec25ParsedPart {
  const purchaseBase = base.kind === 'purchased' || base.source === 'purchased' || base.source === 'quote'
  const qty =
    extra.qty_pieces > 0 && (purchaseBase || base.qty_pieces <= 0) ? extra.qty_pieces : base.qty_pieces || extra.qty_pieces || 1
  return {
    ...base,
    qty_pieces: qty,
    qty_generator: purchaseBase ? extra.qty_generator || base.qty_generator : base.qty_generator,
    qty_raw: extra.qty_raw && (purchaseBase || !base.qty_raw) ? extra.qty_raw : base.qty_raw,
    supplier: extra.supplier || base.supplier,
    quoted_unit_price: extra.quoted_unit_price || base.quoted_unit_price,
    material_raw: purchaseBase ? extra.material_raw || base.material_raw : base.material_raw || extra.material_raw,
    materials: purchaseBase && extra.materials.length ? extra.materials : base.materials.length ? base.materials : extra.materials,
    note: [base.note, extra.note].filter(Boolean).join(' / ').slice(0, 400),
    source: extra.source || base.source,
    kind: purchaseBase ? 'purchased' : base.kind,
    include: purchaseBase ? true : base.include,
    unfoldable: purchaseBase ? false : base.unfoldable,
  }
}

export function mergePurchaseParts(base: Ec25ParsedPart[], extra: Ec25ParsedPart[]): Ec25ParsedPart[] {
  const out = [...base]
  for (const row of extra) {
    const idx = out.findIndex((p) => samePurchaseItem(p, row))
    if (idx >= 0) {
      out[idx] = mergePurchaseIntoBase(out[idx], row)
      continue
    }
    out.push(row)
  }
  return uniquify(out)
}

export function isPurchaseListExcelName(name: string): boolean {
  return /\.(xlsx?|xlsm)$/i.test(name)
}

export function isPurchaseListPdfName(name: string): boolean {
  return /\.pdf$/i.test(name)
}

function ocrBox(b: { id?: string; text?: string; conf?: number; x0?: number; y0?: number; x1?: number; y1?: number }, i: number): OcrBox {
  return {
    id: b.id || `b${i}`,
    text: String(b.text || ''),
    conf: Number(b.conf || 0),
    x0: Number(b.x0 || 0),
    y0: Number(b.y0 || 0),
    x1: Number(b.x1 || 0),
    y1: Number(b.y1 || 0),
  }
}

function looksLikePurchasePage(page: { page_kind?: string; header_ocr?: string; ocr?: string }): boolean {
  const kind = String(page.page_kind || '')
  if (kind === 'purchase_list' || kind === 'quote' || kind === 'detail') return true
  const blob = `${page.header_ocr || ''} ${page.ocr || ''}`
  return /購入部品|購入品一覧|購入品リスト|購入先|部品名称/.test(blob)
}

export function purchasePagesFromIndex(index: DorderIndexPayload): MappedPage[] {
  const pages = (index.pages || []).map((p) => ({
    page: p.page,
    page_kind: looksLikePurchasePage(p) ? (p.page_kind === 'quote' || p.page_kind === 'detail' ? String(p.page_kind) : 'purchase_list') : String(p.page_kind || 'document'),
    image: '',
    width: p.width || 900,
    height: 1200,
    boxes: (p.boxes || []).map((b, i) => ocrBox(b, i)),
  }))
  const hasTable = pages.some((p) => p.page_kind === 'purchase_list' || p.page_kind === 'quote' || p.page_kind === 'detail')
  if (hasTable) return pages.filter((p) => p.page_kind === 'purchase_list' || p.page_kind === 'quote' || p.page_kind === 'detail')
  return pages
    .filter((p) => p.page_kind !== 'drawing' && p.page_kind !== 'sashizu')
    .map((p) => ({ ...p, page_kind: 'purchase_list' }))
}

export function partsFromPurchaseOcr(index: DorderIndexPayload): Ec25ParsedPart[] {
  const mapped = purchasePagesFromIndex(index).map((p) => ({
    ...p,
    boxes: autoMapBoxes(p.boxes, p.page_kind),
  }))
  return partsFromMappedPages(mapped).filter((p) => p.kind === 'purchased' || p.source === 'purchased' || p.source === 'quote')
}

export function dorderExtractFromUnknown(raw: unknown): DorderAiExtract {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const partsRaw = Array.isArray(obj.parts) ? obj.parts : []
  const parts: DorderAiPart[] = partsRaw
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const name = cellText(r.part_name || r.category)
      if (!name) return null
      const source =
        r.source === 'drawing' ? 'drawing' : r.source === 'quote' ? 'quote' : r.source === 'detail' ? 'detail' : 'purchased'
      return {
        part_key: cellText(r.part_key),
        part_name: name,
        material: cellText(r.material),
        qty: Number(r.qty) || 1,
        unit: cellText(r.unit) || '個',
        unit_price: parsePrice(r.unit_price),
        supplier: cellText(r.supplier),
        category: cellText(r.category),
        note: cellText(r.note),
        source,
        page: Number(r.page) || undefined,
      } satisfies DorderAiPart
    })
    .filter((x): x is DorderAiPart => Boolean(x))
  return {
    order_no: cellText(obj.order_no),
    product_name: cellText(obj.product_name),
    model: cellText(obj.model),
    qty: Number(obj.qty) || 1,
    parts,
  }
}

export function partsFromPurchaseAi(raw: unknown): Ec25ParsedPart[] {
  return partsFromAiExtract(dorderExtractFromUnknown(raw)).filter(
    (p) => p.kind === 'purchased' || p.source === 'purchased' || p.source === 'quote' || p.source === 'detail'
  )
}
