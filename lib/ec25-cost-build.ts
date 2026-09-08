import { inferProductCategory } from '@/lib/product-category'
import { buildCostElements, type Ec25CostElement, type ProductCostRow } from '@/lib/ec25-material-match'
import {
  type Ec25CoverMeta,
  type Ec25ParsedPart,
} from '@/lib/ec25-drawing-bom'
import { lookupPdfPages, type Ec25PdfIndex } from '@/lib/ec25-drawing-match'
import { heuristicUnfold, totalCostQty, type UnfoldResult } from '@/lib/ec25-unfold-core'
import { computeCostLineFromMasterUnitPrice } from '@/lib/work-order-cost-from-product-master'

export type Ec25AnalyzeRow = {
  part_key: string
  part_name: string
  drawing_no: string
  sheet: string
  kind: Ec25ParsedPart['kind']
  include: boolean
  unfoldable: boolean
  material_raw: string
  note: string
  qty_pieces: number
  qty_unit: string
  qty_raw: string
  elements: Ec25CostElement[]
  unfold: UnfoldResult
  cost_qty: number
  cost_unit: string
  material_cost: number
  line_total: number
  pdf_pages: number[]
  part: Ec25ParsedPart
}

export function costQtyForElement(
  el: { role?: string; quantity?: number | null; drawing_spec?: boolean },
  index: number,
  unfoldQty: number,
  kind: Ec25AnalyzeRow['kind']
): number {
  if (el.role === 'fastener') return Number(el.quantity || 0)
  if (kind === 'assembly') return 0
  const isSpec = el.drawing_spec === true || (index === 0 && el.drawing_spec !== false)
  if (isSpec) return unfoldQty
  return el.quantity != null && el.quantity > 0 ? Number(el.quantity) : 0
}

function sheetAreaM2FromProduct(name: string, spec: string): number | null {
  const blob = `${name} ${spec}`.replace(/\s+/g, '')
  const m = blob.match(/(\d{3,4})[×xX](\d{3,4})/)
  if (!m) return null
  const area = (Number(m[1]) * Number(m[2])) / 1_000_000
  return area >= 0.4 ? Number(area.toFixed(6)) : null
}

export function buildAnalyzeRows(
  parts: Ec25ParsedPart[],
  products: ProductCostRow[],
  drawingPages: Record<string, number[]> | Ec25PdfIndex = {},
  unfoldOverrides: Record<string, UnfoldResult> = {}
): Ec25AnalyzeRow[] {
  return parts.map((part) => {
    const elements = buildCostElements(part, products)
    const unfold = unfoldOverrides[part.part_key] || heuristicUnfold(part)
    let { qty, unit } = totalCostQty(part, unfold)
    const sheetArea = sheetAreaM2FromProduct(elements[0]?.product_name || '', elements[0]?.spec || '')
    if (unfold.area_m2 && sheetArea && (unfold.qty_unit === 'm2' || unit === 'm2')) {
      qty = Number(((unfold.area_m2 * part.qty_pieces) / sheetArea).toFixed(4))
      unit = 'pcs'
    }
    let materialCost = 0
    let lineTotal = 0
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      const elQty = costQtyForElement(el, i, qty, part.kind)
      const one = computeCostLineFromMasterUnitPrice({
        productCost: el.unit_price,
        quantity: elQty,
        labor_cost: 0,
        cost_type: '加',
      })
      materialCost += one.material_cost
      lineTotal += one.line_total
    }
    return {
      part_key: part.part_key,
      part_name: part.part_name,
      drawing_no: part.drawing_no,
      sheet: part.sheet,
      kind: part.kind,
      include: part.include,
      unfoldable: part.unfoldable,
      material_raw: part.material_raw,
      note: part.note,
      qty_pieces: part.qty_pieces,
      qty_unit: part.qty_unit,
      qty_raw: part.qty_raw,
      elements,
      unfold,
      cost_qty: qty,
      cost_unit: unit,
      material_cost: materialCost,
      line_total: lineTotal,
      pdf_pages: lookupPdfPages(part.drawing_no, part.part_key, part.part_name, drawingPages),
      part,
    }
  })
}

export type Ec25OrderDraft = {
  order_no: string
  product_name: string
  qty: number
  unit: string
  note: string
}

function asOrderDraft(input: {
  order_no?: string
  product_name?: string
  qty?: number
  unit?: string
  note?: string
}): Ec25OrderDraft {
  return {
    order_no: String(input.order_no || '').trim(),
    product_name: String(input.product_name || '').trim(),
    qty: Number(input.qty) > 0 ? Number(input.qty) : 1,
    unit: input.unit || '台',
    note: String(input.note || ''),
  }
}

export function defaultWorkOrder(cover: Ec25CoverMeta) {
  const lines = (cover.orders || [])
    .map((o) => asOrderDraft(o))
    .filter((o) => o.order_no || o.product_name)
  const first = lines[0]
  const productName = first?.product_name || cover.product_name || 'EC25型乾燥機(試作機)'
  const modelType = cover.model_type || productName
  return {
    order_no: first?.order_no || cover.order_no || 'DR8-EC25',
    product_name: productName,
    model: modelType,
    bom_model: modelType,
    qty: first?.qty || cover.qty || 1,
    unit: first?.unit || '台',
    extra_orders: lines.slice(1),
    product_category: inferProductCategory(modelType, productName),
  }
}

export type Ec25WorkOrderDraft = ReturnType<typeof defaultWorkOrder>

export function expandWorkOrders(workOrder: Ec25WorkOrderDraft): Ec25WorkOrderDraft[] {
  const extras = Array.isArray(workOrder.extra_orders) ? workOrder.extra_orders : []
  const primary: Ec25WorkOrderDraft = { ...workOrder, extra_orders: [] }
  const rest = extras
    .map((e) => asOrderDraft(e))
    .filter((e) => e.order_no)
    .map((e) => ({
      ...workOrder,
      order_no: e.order_no,
      product_name: e.product_name || workOrder.product_name,
      qty: e.qty,
      unit: e.unit || workOrder.unit,
      extra_orders: [],
    }))
  return [primary, ...rest]
}
