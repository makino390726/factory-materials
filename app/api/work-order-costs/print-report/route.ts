import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ReportType = 'order' | 'line'

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const reportType = (searchParams.get('type') === 'line' ? 'line' : 'order') as ReportType

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

        current.material_cost += toNumber(item.material_cost)
        current.labor_cost += toNumber(item.labor_cost)
        current.indirect_cost += toNumber(item.indirect_cost)
        current.total_cost += toNumber(item.line_total)

        grouped.set(masterId, current)
      }

      const rows = Array.from(grouped.values())
        .map((row) => ({
          ...row,
          unit_cost: row.total_cost,
        }))
        .sort((a, b) => a.order_no.localeCompare(b.order_no, 'ja-JP'))

      // 機種ごとのBOM合計を計算
      const partKeys = Array.from(grouped.keys())
      let bomMap = new Map<string, string>()

      if (partKeys.length > 0) {
        const { data: bomRows, error: bomError } = await supabase
          .from('heater_bom')
          .select('model, part_key')
          .in('part_key', partKeys)

        if (!bomError && bomRows) {
          for (const bom of bomRows) {
            const model = String(bom.model || '').trim()
            const partKey = String(bom.part_key || '').trim()
            if (model && partKey) {
              bomMap.set(partKey, model)
            }
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
        
        if (!current.product_code) {
          current.product_code = partKey
        }
        if (!current.part_name && row.product_name) {
          current.part_name = row.product_name
        }
        
        current.material_cost += row.material_cost
        current.labor_cost += row.labor_cost
        current.indirect_cost += row.indirect_cost
        current.total_cost += row.total_cost
        bomSummary.set(model, current)
      }

      const bomSummaryRows = Array.from(bomSummary.values()).sort((a, b) =>
        a.model.localeCompare(b.model, 'ja-JP')
      )

      return NextResponse.json({ reportType, rows, bomSummary: bomSummaryRows })
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

    const latestByWorkOrder = new Map<string, any>()
    for (const header of headers || []) {
      const workOrderId = String(header.work_order_id || '').trim()
      if (!workOrderId || latestByWorkOrder.has(workOrderId)) continue
      latestByWorkOrder.set(workOrderId, header)
    }

    const workOrderIds = Array.from(latestByWorkOrder.keys())
    let workOrderMap = new Map<string, any>()

    if (workOrderIds.length > 0) {
      const { data: workOrders, error: workOrderError } = await supabase
        .from('work_orders')
        .select('id, order_no, product_name, model, bom_model, qty')
        .in('id', workOrderIds)

      if (workOrderError) {
        console.error('print report work orders fetch error:', workOrderError)
        return NextResponse.json({ error: workOrderError.message }, { status: 500 })
      }

      workOrderMap = new Map((workOrders || []).map((w) => [String(w.id), w]))
    }

    const rows = Array.from(latestByWorkOrder.values())
      .map((header) => {
        const workOrder = workOrderMap.get(String(header.work_order_id))
        return {
          order_no: String(workOrder?.order_no || header.order_no || ''),
          product_name: String(workOrder?.product_name || ''),
          spec: String(workOrder?.model || ''),
          quantity: Math.max(0, toNumber(workOrder?.qty)),
          unit_cost: (() => {
            const qty = Math.max(0, toNumber(workOrder?.qty))
            const total = toNumber(header.total_cost)
            if (qty <= 0) return 0
            return total / qty
          })(),
          material_cost: toNumber(header.total_material_cost),
          labor_cost: toNumber(header.total_labor_cost),
          indirect_cost: toNumber(header.total_indirect_cost),
          total_cost: toNumber(header.total_cost),
        }
      })
      .sort((a, b) => a.order_no.localeCompare(b.order_no, 'ja-JP'))

    // BOMベースのD指令の場合、BOM合計を計算
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
          lineCostMap.set(partKey, {
            material: toNumber(row.material_cost),
            labor: toNumber(row.labor_cost),
            indirect: toNumber(row.indirect_cost),
            total: toNumber(row.line_total),
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

          if (!firstProductCode && partInfo?.product_code) {
            firstProductCode = partInfo.product_code
          }
          if (!firstPartName && partInfo?.part_name) {
            firstPartName = partInfo.part_name
          }
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

    const bomSummaryRows = Array.from(bomSummary.values()).sort((a, b) =>
      a.model.localeCompare(b.model, 'ja-JP')
    )

    return NextResponse.json({ reportType, rows, bomSummary: bomSummaryRows })
  } catch (error) {
    console.error('print report unexpected error:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
