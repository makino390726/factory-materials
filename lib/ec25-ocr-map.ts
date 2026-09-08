/**
 * スキャン図面の OCR 枠を、ラベル近傍／表ヘッダ列でフィールドに割り当てる。
 * Vision の自由記述抽出より、枠→項目のマッピングの方が指令番号・図番・部品名を取り違えにくい。
 */

import {
  cellText,
  classifyKind,
  compactCell,
  normalizeDrawingNo,
  parseMaterialToken,
  type Ec25CoverMeta,
  type Ec25MaterialToken,
  type Ec25OrderLine,
  type Ec25ParsedPart,
  type Ec25QtyUnit,
} from '@/lib/ec25-drawing-bom'
import type { Ec25PdfIndex, Ec25PdfPageHit } from '@/lib/ec25-drawing-match'

export type MapField =
  | 'order_no'
  | 'product_name'
  | 'order_qty'
  | 'part_key'
  | 'part_name'
  | 'material'
  | 'qty'
  | 'supplier'
  | 'unit_price'
  | 'ignore'

export type OcrBox = {
  id: string
  text: string
  conf: number
  x0: number
  y0: number
  x1: number
  y1: number
  field?: MapField | ''
  row?: number
}

export type MappedFields = {
  order_no?: string
  product_name?: string
  order_qty?: string
  part_key?: string
  part_name?: string
  material?: string
  qty?: string
  supplier?: string
  unit_price?: string
}

export type MappedElement = {
  id: string
  material: string
  qty: string
  supplier: string
  unit_price: string
  drawing_spec?: boolean
}

export type MappedPage = {
  page: number
  page_kind: string
  image: string
  title_image?: string
  session?: string
  width: number
  height: number
  boxes: OcrBox[]
  fields?: MappedFields
  orders?: Ec25OrderLine[]
  elements?: MappedElement[]
  components?: MappedElement[]
}

export const MAP_SEQUENCE: MapField[] = [
  'order_no',
  'product_name',
  'order_qty',
  'part_key',
  'part_name',
  'material',
  'qty',
  'supplier',
]

export const MAP_FIELDS: { field: MapField; label: string; color: string }[] = [
  { field: 'order_no', label: '指令番号', color: '#22d3ee' },
  { field: 'product_name', label: '指令名/機種名', color: '#fbbf24' },
  { field: 'order_qty', label: '何台', color: '#67e8f9' },
  { field: 'part_key', label: 'パーツキー', color: '#34d399' },
  { field: 'part_name', label: 'パーツ名', color: '#a78bfa' },
  { field: 'material', label: '図面仕様材料名', color: '#fb923c' },
  { field: 'qty', label: '数量', color: '#38bdf8' },
  { field: 'supplier', label: '購入先', color: '#f472b6' },
  { field: 'unit_price', label: '単価', color: '#a3e635' },
  { field: 'ignore', label: '無視', color: '#64748b' },
]

export const FIELD_COLOR: Record<MapField | '', string> = Object.fromEntries([
  ...MAP_FIELDS.map((f) => [f.field, f.color] as const),
  ['', '#94a3b8'],
]) as Record<MapField | '', string>

export function mapFieldLabel(field: MapField | '', elIdx = 0): string {
  if (field === 'material') return elIdx === 0 ? '図面仕様材料名' : `構成要素${elIdx + 1}`
  if (field === 'qty') return elIdx === 0 ? '必要量(AI展開)' : '数量'
  return MAP_FIELDS.find((f) => f.field === field)?.label || ''
}

const TABLE_FIELDS = new Set<MapField>(['part_key', 'part_name', 'material', 'qty', 'supplier', 'unit_price'])
const DRAWING_VALUE_RE =
  /(?:SK\s*\d+|SSK|HMG\s*\d{2}|SP\s*11|SPR|CVES|A3B|A4B)[- ]?[0-9A-Z△▲Δ][0-9A-Z\- △▲Δ]{1,28}/i
const MATERIAL_VALUE_RE =
  /(?:ZAM|SPHC|SGCC|SECC|S45C|SS400|SUS\s*\d+|FB\s*\d+|カラー鋼板|t\s*\d)/i
const ORDER_VALUE_RE = /^(?:D?令)?\s*\d{1,2}[-−]\s*\d{2,5}$/
const HEADER_NAME_RE = /^(分類|型式|部品名称|部品名|品名|規格|個数|購入先|備考|図番|単価|金額)$/

function compact(s: string): string {
  return compactCell(s)
}

function cx(b: OcrBox): number {
  return (b.x0 + b.x1) / 2
}

function cy(b: OcrBox): number {
  return (b.y0 + b.y1) / 2
}

function h(b: OcrBox): number {
  return Math.max(0.001, b.y1 - b.y0)
}

export function detectLabel(text: string, pageKind: string): MapField | '' {
  const t = compact(text)
  if (!t || t.length > 14) return ''
  if (/^(指図No|指図NO|指図番号|指令番号|指令No|指図)$/i.test(t)) return 'order_no'
  if (/^(指令数量|台数|何台|製作台数)$/.test(t)) return 'order_qty'
  if (/^(機種名|物件名)$/.test(t)) return 'product_name'
  if (/^(図番|図面番号|型式)$/.test(t)) return 'part_key'
  if (/^(部品名称|部品名|図名)$/.test(t)) return 'part_name'
  if (t === '品名') {
    return pageKind === 'sashizu' || pageKind === 'detail' ? 'product_name' : 'part_name'
  }
  if (t === '機種') return 'product_name'
  if (/^(材質|規格|構成要素|図面仕様材料名|図面仕様)$/.test(t)) return 'material'
  if (t === '備考' && pageKind === 'quote') return 'material'
  if (/^(個数|数量)$/.test(t)) return 'qty'
  if (/^(購入先|仕入先)$/.test(t)) return 'supplier'
  if (/^(単価|金額)$/.test(t)) return 'unit_price'
  return ''
}

function isLabelBox(b: OcrBox, pageKind: string): boolean {
  return Boolean(detectLabel(b.text, pageKind))
}

function findValueRightOrBelow(label: OcrBox, boxes: OcrBox[], taken: Set<string>): OcrBox | null {
  const rowH = h(label)
  const right = boxes
    .filter(
      (b) =>
        b.id !== label.id &&
        !taken.has(b.id) &&
        !isLabelBox(b, '') &&
        b.x0 >= label.x1 - 0.012 &&
        Math.abs(cy(b) - cy(label)) <= rowH * 1.35 &&
        b.x0 - label.x1 < 0.42
    )
    .sort((a, b) => a.x0 - b.x0)
  if (right[0]) return right[0]

  const below = boxes
    .filter(
      (b) =>
        b.id !== label.id &&
        !taken.has(b.id) &&
        !isLabelBox(b, '') &&
        b.y0 >= label.y1 - 0.006 &&
        Math.abs(cx(b) - cx(label)) < 0.2 &&
        b.y0 - label.y1 < 0.14
    )
    .sort((a, b) => a.y0 - b.y0)
  return below[0] || null
}

function findHeaderCluster(boxes: OcrBox[], pageKind: string): OcrBox[] {
  const labels = boxes.filter((b) => TABLE_FIELDS.has(detectLabel(b.text, pageKind) as MapField))
  const clusters: OcrBox[][] = []
  for (const b of [...labels].sort((a, c) => cy(a) - cy(c))) {
    const hit = clusters.find((c) => Math.abs(cy(c[0]) - cy(b)) < 0.028)
    if (hit) hit.push(b)
    else clusters.push([b])
  }
  const best = clusters.sort((a, b) => b.length - a.length)[0]
  return best && best.length >= 3 ? best : []
}

function assignTableColumns(boxes: OcrBox[], headers: OcrBox[], pageKind: string) {
  const headerY1 = Math.max(...headers.map((x) => x.y1))
  const cols = headers
    .map((hdr) => ({
      field: detectLabel(hdr.text, pageKind) as MapField,
      cx: cx(hdr),
      x0: 0,
      x1: 1,
    }))
    .filter((c) => c.field)
    .sort((a, b) => a.cx - b.cx)
  for (let i = 0; i < cols.length; i++) {
    cols[i].x0 = i === 0 ? 0 : (cols[i - 1].cx + cols[i].cx) / 2
    cols[i].x1 = i === cols.length - 1 ? 1 : (cols[i].cx + cols[i + 1].cx) / 2
  }
  const headerIds = new Set(headers.map((x) => x.id))
  const data = boxes.filter((b) => !headerIds.has(b.id) && b.y0 > headerY1 + 0.004)
  const rows: OcrBox[][] = []
  for (const b of [...data].sort((a, c) => cy(a) - cy(c))) {
    const row = rows.find((r) => Math.abs(cy(r[0]) - cy(b)) < 0.016)
    if (row) row.push(b)
    else rows.push([b])
  }
  rows.forEach((row, ri) => {
    const useful = row.filter((b) => !isLabelBox(b, pageKind))
    if (useful.length === 0) return
    for (const b of useful) {
      const col = cols.find((c) => cx(b) >= c.x0 && cx(b) < c.x1)
      if (!col) continue
      b.field = col.field
      b.row = ri + 1
    }
  })
}

function autoAssignLooseValues(boxes: OcrBox[], pageKind: string, taken: Set<string>) {
  for (const b of boxes) {
    if (taken.has(b.id) || b.field) continue
    const t = compact(b.text)
    if (ORDER_VALUE_RE.test(t) || /^令\s*\d/.test(t)) {
      b.field = 'order_no'
      taken.add(b.id)
      continue
    }
    if ((pageKind === 'drawing' || pageKind === 'sashizu') && DRAWING_VALUE_RE.test(t) && t.length >= 6) {
      b.field = 'part_key'
      taken.add(b.id)
      continue
    }
    if (pageKind === 'drawing' && MATERIAL_VALUE_RE.test(t) && t.length <= 24) {
      b.field = 'material'
      taken.add(b.id)
    }
  }
}

export function autoMapBoxes(input: OcrBox[], pageKind: string): OcrBox[] {
  const boxes = input.map((b) => ({ ...b, field: b.field || ('' as const), row: b.row }))
  const taken = new Set<string>()

  const headers = findHeaderCluster(boxes, pageKind)
  if (headers.length) {
    for (const hdr of headers) taken.add(hdr.id)
    assignTableColumns(boxes, headers, pageKind)
    for (const b of boxes) {
      if (b.field && b.row) taken.add(b.id)
    }
  }

  const labels = boxes.filter((b) => !taken.has(b.id) && isLabelBox(b, pageKind))
  labels.sort((a, b) => cy(a) - cy(b) || a.x0 - b.x0)
  for (const label of labels) {
    const field = detectLabel(label.text, pageKind)
    if (!field || field === 'ignore') continue
    taken.add(label.id)
    const value = findValueRightOrBelow(label, boxes, taken)
    if (!value) continue
    if (field === 'part_name' && pageKind === 'drawing') {
      value.field = 'part_name'
      taken.add(value.id)
      const next = findValueRightOrBelow(
        { ...label, y0: value.y0, y1: value.y1, x0: label.x0, x1: label.x1 },
        boxes.filter((b) => b.y0 >= value.y1 - 0.004),
        taken
      )
      if (next && !DRAWING_VALUE_RE.test(compact(next.text))) {
        next.field = 'product_name'
        taken.add(next.id)
      }
      continue
    }
    value.field = field
    taken.add(value.id)
  }

  autoAssignLooseValues(boxes, pageKind, taken)
  return boxes
}

function emptyFields(partial?: MappedFields): MappedFields {
  return {
    order_no: '',
    product_name: '',
    order_qty: '',
    part_key: '',
    part_name: '',
    material: '',
    qty: '',
    supplier: '',
    unit_price: '',
    ...partial,
  }
}

export function emptyOrder(partial?: Partial<Ec25OrderLine>): Ec25OrderLine {
  return {
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    order_no: '',
    product_name: '',
    qty: 1,
    unit: '台',
    note: '',
    ...partial,
  }
}

export function normalizeOrderNo(raw: string): string {
  const s = String(raw || '').replace(/^D/i, '').replace(/\s+/g, '')
  if (!s) return ''
  return s.startsWith('令') ? s : `令${s}`
}

export function hostOrdersPage(pages: MappedPage[]): MappedPage | undefined {
  return pages.find((p) => p.page_kind === 'sashizu') || pages[0]
}

export function applyOrderField(order: Ec25OrderLine, field: MapField, text: string): Ec25OrderLine {
  if (field === 'order_no') return { ...order, order_no: normalizeOrderNo(text) }
  if (field === 'product_name') return { ...order, product_name: text }
  if (field === 'order_qty') return { ...order, qty: parseQty(text) }
  return order
}

export function isCoverMapField(field: MapField | ''): boolean {
  return field === 'order_no' || field === 'product_name' || field === 'order_qty'
}

export function emptyElement(partial?: Partial<MappedElement>): MappedElement {
  return {
    id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    material: '',
    qty: '',
    supplier: '',
    unit_price: '',
    drawing_spec: false,
    ...partial,
  }
}

export function ensureDrawingElements(list: MappedElement[] | undefined): MappedElement[] {
  const raw = list?.length ? list : [emptyElement({ drawing_spec: true, id: 'el-spec' })]
  return raw.map((e, i) =>
    emptyElement({
      ...e,
      id: e.id || (i === 0 ? 'el-spec' : `el-${i}`),
      drawing_spec: i === 0,
    })
  )
}

export function isIdentityMapField(field: MapField | ''): boolean {
  return field === 'part_key' || field === 'part_name'
}

export function isElementMapField(field: MapField | ''): boolean {
  return field === 'material' || field === 'qty' || field === 'supplier' || field === 'unit_price'
}

export function applyElementField(el: MappedElement, field: MapField, text: string): MappedElement {
  if (field === 'material') return { ...el, material: text }
  if (field === 'qty') return { ...el, qty: text }
  if (field === 'supplier') return { ...el, supplier: text }
  if (field === 'unit_price') return { ...el, unit_price: text }
  return el
}

export function elementsFromPage(page: MappedPage): MappedElement[] {
  const raw = page.elements?.length ? page.elements : page.components
  if (raw && raw.length > 0) {
    return ensureDrawingElements(raw)
  }
  const material = cellText(page.fields?.material) || fieldText(page.boxes || [], 'material')
  const qty = cellText(page.fields?.qty) || fieldText(page.boxes || [], 'qty')
  const supplier = cellText(page.fields?.supplier) || fieldText(page.boxes || [], 'supplier')
  const unitPrice = cellText(page.fields?.unit_price) || fieldText(page.boxes || [], 'unit_price')
  if (!material && !qty && !supplier) return ensureDrawingElements(undefined)
  return ensureDrawingElements([emptyElement({ drawing_spec: true, material, qty: '', supplier, unit_price: unitPrice })])
}

export function applyAutoMap(pages: MappedPage[]): MappedPage[] {
  const hostIdx = pages.findIndex((p) => p.page_kind === 'sashizu')
  const host = hostIdx >= 0 ? hostIdx : 0
  return pages.map((p, i) => ({
    ...p,
    boxes: (p.boxes || []).map((b) => ({ ...b, field: '' as const, row: undefined })),
    fields: emptyFields(),
    orders: i === host ? [emptyOrder()] : undefined,
    elements: ensureDrawingElements(undefined),
  }))
}

function qtyUnit(raw: string | undefined): Ec25QtyUnit {
  const t = String(raw || '').toLowerCase()
  if (t === 'm' || t.includes('ｍ')) return 'm'
  if (t === 'm2' || t.includes('㎡')) return 'm2'
  if (t.includes('式') || t.includes('set')) return 'set'
  return 'pcs'
}

function looksLikeHeader(name: string): boolean {
  return HEADER_NAME_RE.test(compactCell(name))
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
  materials?: Ec25MaterialToken[]
}): Ec25ParsedPart {
  const materials =
    input.materials && input.materials.length > 0
      ? input.materials.map((m, i) => ({
          ...m,
          drawing_spec: m.drawing_spec === true ? true : m.drawing_spec === false ? false : i === 0,
        }))
      : input.material
        ? [{ ...parseMaterialToken(input.material), drawing_spec: true }]
        : []
  const spec = materials.find((m) => m.drawing_spec) || materials[0]
  const materialRaw = spec?.raw || input.material
  const kind = classifyKind(input.name, materialRaw, input.drawing, input.sheet)
  const key = normalizeDrawingNo(input.drawing) || input.drawing || `BUY-${compactCell(input.name).slice(0, 24) || 'ITEM'}`
  const mappedKind = input.source === 'purchased' || input.source === 'quote' ? 'purchased' : kind
  return {
    sheet: input.sheet,
    size: '',
    drawing_no: normalizeDrawingNo(input.drawing),
    drawing_raw: input.drawing,
    part_key: key,
    part_name: input.name,
    material_raw: materialRaw,
    materials,
    fasteners: [],
    qty_generator: input.qty,
    qty_chamber: 0,
    qty_pieces: input.qty || 1,
    qty_unit: input.unit,
    qty_raw: String(input.qty || ''),
    note: input.note,
    kind: mappedKind,
    include: mappedKind !== 'assembly',
    unfoldable: kind === 'sheet' || kind === 'profile',
    quoted_unit_price: input.quoted && input.quoted > 0 ? input.quoted : null,
    supplier: input.supplier || '',
    source: input.source,
  }
}

function fieldText(boxes: OcrBox[], field: MapField): string {
  return boxes
    .filter((b) => b.field === field)
    .map((b) => cellText(b.text))
    .filter(Boolean)
    .join(' ')
}

function parseQty(raw: string): number {
  return parseOptionalQty(raw) || 1
}

function parseOptionalQty(raw: string): number | null {
  const s = String(raw || '').replace(/[^\d.]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parsePrice(raw: string): number | null {
  const n = Number(String(raw || '').replace(/[,，円¥\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function tableSource(pageKind: string): NonNullable<Ec25ParsedPart['source']> {
  if (pageKind === 'quote') return 'quote'
  if (pageKind === 'detail') return 'detail'
  return 'purchased'
}

export function ordersFromMappedPages(pages: MappedPage[]): Ec25OrderLine[] {
  const host = hostOrdersPage(pages)
  if (host?.orders && host.orders.length > 0) {
    return host.orders.map((o) => emptyOrder(o))
  }
  const prefer = [...pages].sort((a, b) => {
    const rank = (k: string) => (k === 'sashizu' ? 0 : k === 'detail' ? 1 : 2)
    return rank(a.page_kind) - rank(b.page_kind)
  })
  let orderNo = ''
  let product = ''
  let qtyRaw = ''
  for (const p of prefer) {
    if (!orderNo) orderNo = cellText(p.fields?.order_no) || fieldText(p.boxes, 'order_no')
    if (!product) product = cellText(p.fields?.product_name) || fieldText(p.boxes, 'product_name')
    if (!qtyRaw) qtyRaw = cellText(p.fields?.order_qty) || fieldText(p.boxes, 'order_qty')
    if (orderNo && product && qtyRaw) break
  }
  return [
    emptyOrder({
      order_no: normalizeOrderNo(orderNo),
      product_name: product,
      qty: parseQty(qtyRaw),
    }),
  ]
}

export function coverFromMappedPages(pages: MappedPage[]): Ec25CoverMeta {
  const orders = ordersFromMappedPages(pages)
  const first = orders[0]
  const product = first?.product_name || ''
  return {
    product_name: product,
    model_type: product,
    created_on: '',
    owner: '',
    order_no: first?.order_no || '',
    qty: first?.qty || 1,
    orders,
  }
}

function partsFromTablePage(page: MappedPage): Ec25ParsedPart[] {
  const byRow = new Map<number, OcrBox[]>()
  for (const b of page.boxes) {
    if (!b.row || !b.field || b.field === 'ignore') continue
    const list = byRow.get(b.row) || []
    list.push(b)
    byRow.set(b.row, list)
  }
  const source = tableSource(page.page_kind)
  const out: Ec25ParsedPart[] = []
  for (const [row, boxes] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const get = (f: MapField) => fieldText(boxes, f)
    const name = get('part_name')
    const key = get('part_key')
    if (!name && !key) continue
    if (name && looksLikeHeader(name)) continue
    const material = get('material')
    const supplier = get('supplier')
    out.push(
      makePart({
        sheet: `${source === 'quote' ? '見積' : source === 'detail' ? '詳細表' : '購入部品表'} p.${page.page}#${row}`,
        drawing: key,
        name: name || key,
        material,
        qty: parseQty(get('qty')),
        unit: qtyUnit(get('qty')),
        note: [supplier ? `購入先:${supplier}` : '', `p.${page.page}`].filter(Boolean).join(' / '),
        source,
        supplier,
        quoted: parsePrice(get('unit_price')),
      })
    )
  }
  return out
}

function partsFromDrawingPage(page: MappedPage): Ec25ParsedPart[] {
  const key = cellText(page.fields?.part_key) || fieldText(page.boxes, 'part_key')
  const name = cellText(page.fields?.part_name) || fieldText(page.boxes, 'part_name')
  if (!key && !name) return []
  if (name && looksLikeHeader(name) && !key) return []
  const els = ensureDrawingElements(elementsFromPage(page))
  const specRaw = compact(els[0]?.material || cellText(page.fields?.material))
  const materials: Ec25MaterialToken[] = []
  if (specRaw) {
    materials.push({ ...parseMaterialToken(specRaw), qty: null, drawing_spec: true })
  }
  for (const e of els.slice(1)) {
    const raw = compact(e.material)
    if (!raw) continue
    materials.push({ ...parseMaterialToken(raw), qty: parseOptionalQty(e.qty), drawing_spec: false })
  }
  const first = els[0]
  const extraNote = materials.filter((m) => !m.drawing_spec).map((m) => m.raw).filter(Boolean)
  return [
    makePart({
      sheet: `図面 p.${page.page}`,
      drawing: key,
      name: name || key,
      material: specRaw,
      qty: 1,
      unit: 'pcs',
      note: [`p.${page.page}`, extraNote.length ? `他構成要素:${extraNote.join(', ')}` : '']
        .filter(Boolean)
        .join(' / '),
      source: 'drawing',
      supplier: first?.supplier || cellText(page.fields?.supplier),
      quoted: parsePrice(first?.unit_price || page.fields?.unit_price || ''),
      materials,
    }),
  ]
}

export function missingDrawingSpecPages(pages: MappedPage[]): number[] {
  return pages
    .filter((p) => {
      if (p.page_kind !== 'drawing') return false
      const key = cellText(p.fields?.part_key) || fieldText(p.boxes || [], 'part_key')
      const name = cellText(p.fields?.part_name) || fieldText(p.boxes || [], 'part_name')
      if (!key && !name) return false
      return !compact(elementsFromPage(p)[0]?.material || '')
    })
    .map((p) => p.page)
}

function sameItem(a: Ec25ParsedPart, b: Ec25ParsedPart): boolean {
  const ak = compact(a.drawing_no || a.part_key).toLowerCase()
  const bk = compact(b.drawing_no || b.part_key).toLowerCase()
  if (ak && bk && ak === bk && !ak.startsWith('buy-')) return true
  const an = compact(a.part_name).toLowerCase()
  const bn = compact(b.part_name).toLowerCase()
  return Boolean(an && bn && (an === bn || an.includes(bn) || bn.includes(an)))
}

function mergeTwo(base: Ec25ParsedPart, extra: Ec25ParsedPart): Ec25ParsedPart {
  const drawing = base.drawing_no || extra.drawing_no
  const mats = [...(base.materials || [])]
  for (const m of extra.materials || []) {
    if (!mats.some((x) => compact(x.raw).toLowerCase() === compact(m.raw).toLowerCase())) mats.push(m)
  }
  const material = mats.map((m) => m.raw).filter(Boolean).join(', ') || base.material_raw || extra.material_raw
  const supplier = base.supplier || extra.supplier
  const quoted = Number(base.quoted_unit_price || extra.quoted_unit_price || 0) || null
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
    materials: mats.length ? mats : material ? [parseMaterialToken(material)] : base.materials,
    qty_pieces: Math.max(base.qty_pieces, extra.qty_pieces) || 1,
    note: [base.note, extra.note].filter(Boolean).join(' / ').slice(0, 400),
    supplier,
    quoted_unit_price: quoted,
    source,
    kind,
    include: kind !== 'assembly',
    unfoldable: kind === 'sheet' || kind === 'profile',
  }
}

export function partsFromMappedPages(pages: MappedPage[]): Ec25ParsedPart[] {
  const drawings: Ec25ParsedPart[] = []
  const others: Ec25ParsedPart[] = []
  for (const page of pages) {
    const kind = String(page.page_kind || '')
    if (kind === 'drawing' || (kind === 'document' && (page.fields?.part_key || page.fields?.part_name))) {
      drawings.push(...partsFromDrawingPage(page))
      continue
    }
    if (kind === 'purchase_list' || kind === 'quote' || kind === 'detail') {
      others.push(...partsFromTablePage(page))
    }
  }
  const out = [...drawings]
  for (const extra of others) {
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

export function indexFromMappedPages(pages: MappedPage[]): Ec25PdfIndex {
  const drawings: Record<string, number[]> = {}
  const by_name: Record<string, number[]> = {}
  const hits: Ec25PdfPageHit[] = []
  const add = (map: Record<string, number[]>, key: string, page: number) => {
    const k = cellText(key)
    if (!k) return
    const list = map[k] || []
    if (!list.includes(page)) list.push(page)
    map[k] = list
  }
  for (const p of pages) {
    const key = cellText(p.fields?.part_key) || fieldText(p.boxes, 'part_key')
    const name = cellText(p.fields?.part_name) || fieldText(p.boxes, 'part_name')
    const isDrawing = p.page_kind === 'drawing' || Boolean(key)
    if (!isDrawing && !name) continue
    if (key) add(drawings, key, p.page)
    if (name) add(by_name, name, p.page)
    hits.push({
      page: p.page,
      drawing_no: key,
      part_name: name,
      model_name: cellText(p.fields?.product_name),
    })
  }
  return { drawings, by_name, pages: hits }
}

export function mappingSummary(pages: MappedPage[]) {
  const parts = partsFromMappedPages(pages)
  const cover = coverFromMappedPages(pages)
  return {
    cover,
    parts,
    assigned: pages.reduce((n, p) => n + p.boxes.filter((b) => b.field && b.field !== 'ignore').length, 0),
    boxes: pages.reduce((n, p) => n + p.boxes.length, 0),
    purchased: parts.filter((p) => p.kind === 'purchased' || p.source === 'purchased' || p.source === 'quote').length,
    drawings: parts.filter((p) => p.source === 'drawing').length,
  }
}
