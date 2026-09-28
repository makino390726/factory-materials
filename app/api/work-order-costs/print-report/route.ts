import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { formatFiscalYearLabel, getCurrentFiscalYear, parseFiscalYearParam } from '@/lib/fiscal-year'
import {
  calcHeaderLaborIndirect,
  costMethodLabel,
  repriceLine,
  usesNewCostMethod,
} from '@/lib/fiscal-cost-method'
import {
  applyModelRealtimeOverlay,
  isLaborFeePartLabel,
  listSavedModelRealtimeCosts,
} from '@/lib/heater-model-realtime-cost'
import { buildLinePartCostUnitMap } from '@/lib/line-part-cost-breakdown'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ReportType = 'order' | 'line' | 'model'

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

type ReportCostItem = {
  material_cost: number
  labor_cost: number
  indirect_cost: number
  line_total: number
  master_id: string
  part_key: string
}

async function loadCostItemsByHeader(headerIds: string[]) {
  const map = new Map<string, ReportCostItem[]>()
  for (let i = 0; i < headerIds.length; i += 150) {
    const chunk = headerIds.slice(i, i + 150)
    const { data, error } = await supabase
      .from('work_order_cost_items')
      .select('work_order_cost_id, material_cost, labor_cost, indirect_cost, line_total, master_id')
      .in('work_order_cost_id', chunk)
    if (error) throw error
    for (const row of data || []) {
      const id = String(row.work_order_cost_id || '')
      if (!id) continue
      const list = map.get(id) || []
      list.push({
        material_cost: toNumber(row.material_cost),
        labor_cost: toNumber(row.labor_cost),
        indirect_cost: toNumber(row.indirect_cost),
        line_total: toNumber(row.line_total),
        master_id: String(row.master_id || '').trim(),
        // 明細テーブルに part_key 列がない環境がある。枝番数量は master_id で対応する。
        part_key: '',
      })
      map.set(id, list)
    }
  }
  return map
}

function orderDisplayCost(
  header: {
    total_material_cost?: unknown
    total_labor_cost?: unknown
    total_indirect_cost?: unknown
    total_cost?: unknown
  },
  items: Array<{ material_cost: number; labor_cost: number; indirect_cost: number; line_total: number }> | undefined,
  fiscalYear: number,
  options?: {
    materialFromItems?: boolean
    unscaledItems?: Array<{ material_cost: number; labor_cost: number }>
  }
) {
  if (!usesNewCostMethod(fiscalYear)) {
    return {
      material_cost: toNumber(header.total_material_cost),
      labor_cost: toNumber(header.total_labor_cost),
      indirect_cost: toNumber(header.total_indirect_cost),
      total_cost: toNumber(header.total_cost),
    }
  }
  if (!items || items.length === 0) {
    const priced = repriceLine(
      fiscalYear,
      toNumber(header.total_material_cost),
      toNumber(header.total_labor_cost),
      toNumber(header.total_indirect_cost),
      toNumber(header.total_cost)
    )
    return {
      material_cost: priced.material,
      labor_cost: priced.labor,
      indirect_cost: priced.indirect,
      total_cost: priced.total,
    }
  }

  let lineMaterial = 0
  let lineLabor = 0
  let lineIndirect = 0
  for (const item of items) {
    const priced = repriceLine(fiscalYear, item.material_cost, item.labor_cost, item.indirect_cost, item.line_total)
    lineMaterial += priced.material
    lineLabor += priced.labor
    lineIndirect += priced.indirect
  }
  const headerLabor = Math.round(toNumber(header.total_labor_cost))
  const headerMaterial = Math.round(toNumber(header.total_material_cost))
  const unscaledLabor = options?.unscaledItems
    ? options.unscaledItems.reduce((sum, item) => sum + item.labor_cost, 0)
    : lineLabor
  const unscaledMaterial = options?.unscaledItems
    ? options.unscaledItems.reduce((sum, item) => sum + item.material_cost, 0)
    : lineMaterial
  const laborAlreadyInLines = headerLabor > 0 && Math.abs(headerLabor - unscaledLabor) < 1
  const labor = laborAlreadyInLines ? headerLabor : headerLabor + lineLabor
  const laborIndirect = laborAlreadyInLines ? 0 : calcHeaderLaborIndirect(headerLabor, '加', fiscalYear)
  const headerMaterialExtra = Math.max(0, headerMaterial - Math.round(unscaledMaterial))
  const material =
    options?.materialFromItems && lineMaterial > 0
      ? lineMaterial + headerMaterialExtra
      : headerMaterial > 0
        ? headerMaterial
        : lineMaterial
  const indirect = lineIndirect + laborIndirect
  return {
    material_cost: material,
    labor_cost: labor,
    indirect_cost: indirect,
    total_cost: material + labor + indirect,
  }
}

type BranchQtyRow = {
  work_order_id: string
  branch_no: string
  part_key: string
  bom_quantity: number
}

function formatBranchNo(branchNo: string): string {
  const stripped = String(branchNo || '').replace(/^[A-Za-z]+/, '').replace(/^0+/, '')
  if (!stripped) return String(branchNo || '')
  return String(parseInt(stripped, 10)).padStart(2, '0')
}

/** 枝番00は工賃。それ以外は構成パーツ数量。明細は1セット分。 */
function constituentMultiplier(orderNo: string, item: ReportCostItem, branches: BranchQtyRow[]): number {
  const masterId = item.master_id
  const partKey = item.part_key
  for (const branch of branches) {
    if (String(branch.branch_no || '') === '00') continue
    const qty = Number(branch.bom_quantity)
    if (!Number.isFinite(qty) || qty <= 0 || qty === 1) continue
    const branchPartKey = String(branch.part_key || '').trim()
    if (partKey && branchPartKey && partKey === branchPartKey) return qty
    const branchNo = String(branch.branch_no || '').trim()
    const stripped = branchNo.replace(/^[A-Za-z]+/, '').replace(/^0+/, '') || branchNo
    const keys = [`${orderNo}-${formatBranchNo(branchNo)}`, `${orderNo}-${stripped}`, `${orderNo}-${branchNo}`, branchPartKey]
    if (masterId && keys.includes(masterId)) return qty
  }
  return 1
}

function scaleItemsByBranchQty(items: ReportCostItem[], orderNo: string, branches: BranchQtyRow[]): ReportCostItem[] {
  return items.map((item) => {
    const qty = constituentMultiplier(orderNo, item, branches)
    if (qty === 1) return item
    return {
      ...item,
      material_cost: item.material_cost * qty,
      labor_cost: item.labor_cost * qty,
      indirect_cost: item.indirect_cost * qty,
      line_total: item.line_total * qty,
    }
  })
}

async function buildModelCostList(fiscalYear: number) {
  const { data: models, error: modelsError } = await supabase
    .from('heater_models')
    .select('model, name')
    .order('model')

  if (modelsError) throw modelsError

  let allBom: Array<{ model: string; part_key: string; part_name: string | null; quantity: number }> = []
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('heater_bom')
      .select('model, part_key, part_name, quantity')
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    allBom = allBom.concat(
      data.map((row) => ({
        model: String(row.model || ''),
        part_key: String(row.part_key || ''),
        part_name: row.part_name == null ? null : String(row.part_name),
        quantity: toNumber(row.quantity),
      }))
    )
    if (data.length < pageSize) break
    from += pageSize
  }

  const partKeys = [...new Set(allBom.map((b) => b.part_key).filter(Boolean))]
  const partsFallbackMap = new Map<
    string,
    {
      cost_price: number | null
      material_cost_total: number | null
      indirect_cost_total: number | null
      part_name: string | null
    }
  >()

  if (partKeys.length > 0) {
    for (let i = 0; i < partKeys.length; i += 150) {
      const chunk = partKeys.slice(i, i + 150)
      const { data: partsData, error: partsError } = await supabase
        .from('heater_parts_master')
        .select('part_key, part_name, cost_price, material_cost_total, indirect_cost_total')
        .in('part_key', chunk)
      if (partsError) throw partsError
      for (const p of partsData || []) {
        partsFallbackMap.set(String(p.part_key), {
          cost_price: p.cost_price ?? null,
          material_cost_total: p.material_cost_total ?? null,
          indirect_cost_total: p.indirect_cost_total ?? null,
          part_name: p.part_name ?? null,
        })
      }
    }
  }

  const lineCostMap = await buildLinePartCostUnitMap(supabase, partKeys, partsFallbackMap)
  const nameByModel = new Map((models || []).map((m) => [String(m.model), String(m.name || '').trim()]))

  type Agg = {
    model: string
    display_name: string
    material_cost: number
    labor_cost: number
    indirect_cost: number
    total_cost: number
    part_count: number
    fee_labor_cost: number
    fee_indirect_cost: number
    has_labor_fee_row: boolean
  }
  const map = new Map<string, Agg>()

  for (const item of allBom) {
    if (!item.model || !item.part_key) continue
    let row = map.get(item.model)
    if (!row) {
      const dn = nameByModel.get(item.model) || ''
      row = {
        model: item.model,
        display_name: dn || item.model,
        material_cost: 0,
        labor_cost: 0,
        indirect_cost: 0,
        total_cost: 0,
        part_count: 0,
        fee_labor_cost: 0,
        fee_indirect_cost: 0,
        has_labor_fee_row: false,
      }
      map.set(item.model, row)
    }

    const qty = item.quantity || 1
    const unit = lineCostMap.get(item.part_key)
    const fallback = partsFallbackMap.get(item.part_key)
    const costPrice = Number(fallback?.cost_price || 0)
    const materialUnit = unit ? Number(unit.material_unit || 0) : Number(fallback?.material_cost_total || 0)
    const laborUnit = unit ? Number(unit.labor_unit || 0) : 0
    const indirectUnit = unit ? Number(unit.indirect_unit || 0) : Number(fallback?.indirect_cost_total || 0)
    const totalUnit = unit
      ? Number(unit.total_unit || materialUnit + laborUnit + indirectUnit)
      : costPrice
    // 製品パーツ計算・部品表と同じ: L指令合計が0なら parts_master.cost_price にフォールバック
    const unitCost = totalUnit || costPrice
    const priced = repriceLine(fiscalYear, materialUnit, laborUnit, indirectUnit, unitCost)

    row.material_cost += priced.material * qty
    row.labor_cost += priced.labor * qty
    row.indirect_cost += priced.indirect * qty
    row.total_cost += priced.total * qty
    row.part_count += 1
    if (isLaborFeePartLabel(item.part_key, item.part_name, fallback?.part_name)) {
      row.has_labor_fee_row = true
      row.fee_labor_cost += priced.labor * qty
      row.fee_indirect_cost += priced.indirect * qty
    }
  }

  for (const m of models || []) {
    const code = String(m.model || '').trim()
    if (!code || map.has(code)) continue
    const dn = String(m.name || '').trim()
    map.set(code, {
      model: code,
      display_name: dn || code,
      material_cost: 0,
      labor_cost: 0,
      indirect_cost: 0,
      total_cost: 0,
      part_count: 0,
      fee_labor_cost: 0,
      fee_indirect_cost: 0,
      has_labor_fee_row: false,
    })
  }

  const savedRealtime = await listSavedModelRealtimeCosts(supabase)

  return {
    fiscal_year: fiscalYear,
    rows: Array.from(map.values())
      .map((row) => {
        const saved = savedRealtime.get(row.model) || null
        const overlaid = saved
          ? applyModelRealtimeOverlay(
              {
                material_cost: row.material_cost,
                labor_cost: row.labor_cost,
                indirect_cost: row.indirect_cost,
                total_cost: row.total_cost,
                fee_labor_cost: row.fee_labor_cost,
                fee_indirect_cost: row.fee_indirect_cost,
                has_labor_fee_row: row.has_labor_fee_row,
              },
              saved
            )
          : null
        const shown = overlaid || row
        return {
          model: row.model,
          display_name: row.display_name,
          part_count: row.part_count,
          material_cost: Math.round(shown.material_cost),
          labor_cost: Math.round(shown.labor_cost),
          indirect_cost: Math.round(shown.indirect_cost),
          total_cost: Math.round(shown.total_cost),
          realtime_applied: Boolean(saved),
          realtime_label: saved?.applied_label || null,
        }
      })
      .sort((a, b) => a.model.localeCompare(b.model, 'ja', { numeric: true })),
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const typeParam = searchParams.get('type')
    const reportType = (
      typeParam === 'line' ? 'line' : typeParam === 'model' ? 'model' : 'order'
    ) as ReportType
    const fiscalYear = parseFiscalYearParam(searchParams.get('fiscal_year'), getCurrentFiscalYear())
    const methodPayload = {
      fiscal_year: fiscalYear,
      fiscal_year_label: formatFiscalYearLabel(fiscalYear),
      formula_label: costMethodLabel(fiscalYear),
      uses_new_method: usesNewCostMethod(fiscalYear),
    }

    if (reportType === 'model') {
      const modelReport = await buildModelCostList(fiscalYear)
      return NextResponse.json({
        reportType,
        ...methodPayload,
        rows: modelReport.rows,
        bomSummary: [],
      })
    }

    if (reportType === 'line') {
      const { data: items, error } = await supabase
        .from('work_order_cost_items')
        .select('master_id, part_name, spec, material_cost, labor_cost, indirect_cost, line_total')
        .eq('master_type', 'ライン原価')

      if (error) {
        console.error('print report line fetch error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const grouped = new Map<string, {
        order_no: string
        product_name: string
        spec: string
        quantity: number
        unit_cost: number
        material_cost: number
        labor_cost: number
        indirect_cost: number
        total_cost: number
      }>()

      for (const item of items || []) {
        const masterId = String(item.master_id || '').trim()
        if (!masterId) continue

        const current = grouped.get(masterId) || {
          order_no: masterId,
          product_name: String(item.part_name || ''),
          spec: String(item.spec || ''),
          quantity: 1,
          unit_cost: 0,
          material_cost: 0,
          labor_cost: 0,
          indirect_cost: 0,
          total_cost: 0,
        }

        if (!current.product_name && item.part_name) current.product_name = String(item.part_name)
        if (!current.spec && item.spec) current.spec = String(item.spec)

        const priced = repriceLine(
          fiscalYear,
          toNumber(item.material_cost),
          toNumber(item.labor_cost),
          toNumber(item.indirect_cost),
          toNumber(item.line_total)
        )
        current.material_cost += priced.material
        current.labor_cost += priced.labor
        current.indirect_cost += priced.indirect
        current.total_cost += priced.total

        grouped.set(masterId, current)
      }

      if (usesNewCostMethod(fiscalYear) && grouped.size > 0) {
        const unitMap = await buildLinePartCostUnitMap(supabase, Array.from(grouped.keys()))
        for (const [partKey, row] of grouped) {
          const unit = unitMap.get(partKey)
          if (!unit) continue
          const priced = repriceLine(
            fiscalYear,
            Number(unit.material_unit || 0),
            Number(unit.labor_unit || 0),
            Number(unit.indirect_unit || 0),
            Number(unit.total_unit || 0)
          )
          row.material_cost = priced.material
          row.labor_cost = priced.labor
          row.indirect_cost = priced.indirect
          row.total_cost = priced.total
        }
      }

      const rows = Array.from(grouped.values())
        .map((row) => ({
          ...row,
          unit_cost: row.total_cost,
        }))
        .sort((a, b) => a.order_no.localeCompare(b.order_no, 'ja-JP'))

      const partKeys = Array.from(grouped.keys())
      const bomMap = new Map<string, string>()

      if (partKeys.length > 0) {
        const { data: bomRows, error: bomError } = await supabase
          .from('heater_bom')
          .select('model, part_key')
          .in('part_key', partKeys)

        if (!bomError && bomRows) {
          for (const bom of bomRows) {
            const model = String(bom.model || '').trim()
            const partKey = String(bom.part_key || '').trim()
            if (model && partKey) bomMap.set(partKey, model)
          }
        }
      }

      const bomSummary = new Map<string, {
        model: string
        product_code: string
        part_name: string
        material_cost: number
        labor_cost: number
        indirect_cost: number
        total_cost: number
      }>()

      for (const [partKey, row] of grouped.entries()) {
        const model = bomMap.get(partKey) || partKey
        const current = bomSummary.get(model) || {
          model,
          product_code: '',
          part_name: '',
          material_cost: 0,
          labor_cost: 0,
          indirect_cost: 0,
          total_cost: 0,
        }

        if (!current.product_code) current.product_code = partKey
        if (!current.part_name && row.product_name) current.part_name = row.product_name

        current.material_cost += row.material_cost
        current.labor_cost += row.labor_cost
        current.indirect_cost += row.indirect_cost
        current.total_cost += row.total_cost
        bomSummary.set(model, current)
      }

      return NextResponse.json({
        reportType,
        ...methodPayload,
        rows,
        bomSummary: Array.from(bomSummary.values()).sort((a, b) => a.model.localeCompare(b.model, 'ja-JP')),
      })
    }

    const { data: headers, error: headerError } = await supabase
      .from('work_order_costs')
      .select('id, work_order_id, order_no, total_material_cost, total_labor_cost, total_indirect_cost, total_cost, updated_at, created_at')
      .not('work_order_id', 'is', null)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })

    if (headerError) {
      console.error('print report order header fetch error:', headerError)
      return NextResponse.json({ error: headerError.message }, { status: 500 })
    }

    type OrderCostHeader = {
      id: string
      work_order_id: string | null
      order_no: string | null
      total_material_cost: number | null
      total_labor_cost: number | null
      total_indirect_cost: number | null
      total_cost: number | null
    }
    type WorkOrderRow = {
      id: string
      order_no: string | null
      product_name: string | null
      model: string | null
      bom_model: string | null
      qty: number | null
    }

    const latestByWorkOrder = new Map<string, OrderCostHeader>()
    for (const header of headers || []) {
      const workOrderId = String(header.work_order_id || '').trim()
      if (!workOrderId || latestByWorkOrder.has(workOrderId)) continue
      latestByWorkOrder.set(workOrderId, header as OrderCostHeader)
    }

    const workOrderIds = Array.from(latestByWorkOrder.keys())
    let workOrderMap = new Map<string, WorkOrderRow>()

    if (workOrderIds.length > 0) {
      const { data: workOrders, error: workOrderError } = await supabase
        .from('work_orders')
        .select('id, order_no, product_name, model, bom_model, qty')
        .in('id', workOrderIds)

      if (workOrderError) {
        console.error('print report work orders fetch error:', workOrderError)
        return NextResponse.json({ error: workOrderError.message }, { status: 500 })
      }

      workOrderMap = new Map((workOrders || []).map((w) => [String(w.id), w as WorkOrderRow]))
    }

    const itemsByHeader = await loadCostItemsByHeader(
      Array.from(latestByWorkOrder.values())
        .map((header) => String(header.id || ''))
        .filter(Boolean)
    )

    const branchesByWorkOrder = new Map<string, BranchQtyRow[]>()
    if (workOrderIds.length > 0) {
      const { data: branchRows, error: branchError } = await supabase
        .from('work_order_branches')
        .select('work_order_id, branch_no, part_key, bom_quantity')
        .in('work_order_id', workOrderIds)
      if (branchError) {
        console.error('print report branches fetch error:', branchError)
        return NextResponse.json({ error: branchError.message }, { status: 500 })
      }
      for (const row of branchRows || []) {
        const workOrderId = String(row.work_order_id || '')
        if (!workOrderId) continue
        const list = branchesByWorkOrder.get(workOrderId) || []
        list.push({
          work_order_id: workOrderId,
          branch_no: String(row.branch_no || ''),
          part_key: String(row.part_key || ''),
          bom_quantity: toNumber(row.bom_quantity),
        })
        branchesByWorkOrder.set(workOrderId, list)
      }
    }

    const rows = Array.from(latestByWorkOrder.values())
      .map((header) => {
        const workOrder = workOrderMap.get(String(header.work_order_id))
        const orderNo = String(workOrder?.order_no || header.order_no || '')
        const rawItems = itemsByHeader.get(String(header.id || '')) || []
        const scaledItems = scaleItemsByBranchQty(
          rawItems,
          orderNo,
          branchesByWorkOrder.get(String(header.work_order_id || '')) || []
        )
        const priced = orderDisplayCost(header, scaledItems, fiscalYear, {
          materialFromItems: usesNewCostMethod(fiscalYear) && scaledItems.length > 0,
          unscaledItems: rawItems,
        })
        if (!usesNewCostMethod(fiscalYear) && rawItems.length > 0) {
          const sum = (items: ReportCostItem[], key: 'material_cost' | 'labor_cost' | 'indirect_cost' | 'line_total') =>
            items.reduce((total, item) => total + item[key], 0)
          priced.material_cost += sum(scaledItems, 'material_cost') - sum(rawItems, 'material_cost')
          priced.labor_cost += sum(scaledItems, 'labor_cost') - sum(rawItems, 'labor_cost')
          priced.indirect_cost += sum(scaledItems, 'indirect_cost') - sum(rawItems, 'indirect_cost')
          priced.total_cost = priced.material_cost + priced.labor_cost + priced.indirect_cost
        }
        const qty = Math.max(0, toNumber(workOrder?.qty))
        return {
          order_no: String(workOrder?.order_no || header.order_no || ''),
          product_name: String(workOrder?.product_name || ''),
          spec: String(workOrder?.model || ''),
          quantity: qty,
          unit_cost: qty > 0 ? priced.total_cost / qty : 0,
          material_cost: priced.material_cost,
          labor_cost: priced.labor_cost,
          indirect_cost: priced.indirect_cost,
          total_cost: priced.total_cost,
        }
      })
      .sort((a, b) => a.order_no.localeCompare(b.order_no, 'ja-JP'))

    const bomSummary = new Map<string, {
      model: string
      product_code: string
      part_name: string
      material_cost: number
      labor_cost: number
      indirect_cost: number
      total_cost: number
    }>()

    for (const workOrder of workOrderMap.values()) {
      const bomModel = String(workOrder?.bom_model || '').trim()
      if (!bomModel) continue

      const { data: bomRows, error: bomError } = await supabase
        .from('heater_bom')
        .select('part_key, quantity, part_name')
        .eq('model', bomModel)

      if (bomError || !bomRows) continue

      const partKeys = bomRows.map((b) => String(b.part_key || '').trim()).filter(Boolean)
      if (partKeys.length === 0) continue

      const { data: partsData, error: partsError } = await supabase
        .from('heater_parts_master')
        .select('part_key, product_code, part_name, cost_price')
        .in('part_key', partKeys)

      if (partsError || !partsData) continue

      const partsMap = new Map(
        (partsData || []).map((p) => [
          String(p.part_key),
          {
            product_code: String(p.product_code || ''),
            part_name: String(p.part_name || ''),
            cost_price: toNumber(p.cost_price),
          },
        ])
      )

      const { data: lineCostRows, error: lineCostError } = await supabase
        .from('work_order_cost_items')
        .select('master_id, material_cost, labor_cost, indirect_cost, line_total')
        .eq('master_type', 'ライン原価')
        .in('master_id', partKeys)

      if (!lineCostError && lineCostRows) {
        const lineCostMap = new Map<string, { material: number; labor: number; indirect: number; total: number }>()
        for (const row of lineCostRows) {
          const partKey = String(row.master_id || '').trim()
          if (!partKey) continue
          const priced = repriceLine(
            fiscalYear,
            toNumber(row.material_cost),
            toNumber(row.labor_cost),
            toNumber(row.indirect_cost),
            toNumber(row.line_total)
          )
          lineCostMap.set(partKey, {
            material: priced.material,
            labor: priced.labor,
            indirect: priced.indirect,
            total: priced.total,
          })
        }

        let materialSum = 0
        let laborSum = 0
        let indirectSum = 0
        let totalSum = 0
        let firstProductCode = ''
        let firstPartName = ''

        for (const bom of bomRows) {
          const partKey = String(bom.part_key || '').trim()
          const qty = toNumber(bom.quantity)
          const partInfo = partsMap.get(partKey)
          const lineCost = lineCostMap.get(partKey)

          if (lineCost) {
            materialSum += lineCost.material * qty
            laborSum += lineCost.labor * qty
            indirectSum += lineCost.indirect * qty
            totalSum += lineCost.total * qty
          } else if (partInfo) {
            totalSum += partInfo.cost_price * qty
          }

          if (!firstProductCode && partInfo?.product_code) firstProductCode = partInfo.product_code
          if (!firstPartName && partInfo?.part_name) firstPartName = partInfo.part_name
        }

        bomSummary.set(bomModel, {
          model: bomModel,
          product_code: firstProductCode,
          part_name: firstPartName,
          material_cost: Math.round(materialSum),
          labor_cost: Math.round(laborSum),
          indirect_cost: Math.round(indirectSum),
          total_cost: Math.round(totalSum),
        })
      }
    }

    return NextResponse.json({
      reportType,
      ...methodPayload,
      rows,
      bomSummary: Array.from(bomSummary.values()).sort((a, b) => a.model.localeCompare(b.model, 'ja-JP')),
    })
  } catch (error) {
    console.error('print report unexpected error:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
