import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  inferProductCategory,
  normalizeProductCategory,
} from '@/lib/product-category'
import { calcLaborCostFromMinutes } from '@/lib/line-part-labor-cost'
import { groupOrdersByHeaterModel } from '@/lib/heater-model-order-match'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function calcBomGrandTotal(model: string): Promise<{
  grand_total: number
  part_count: number
  material_total: number
  labor_total: number
  indirect_total: number
}> {
  const { data: bomRows, error } = await supabase
    .from('heater_bom')
    .select('part_key, quantity')
    .eq('model', model)

  if (error) throw error
  if (!bomRows || bomRows.length === 0) {
    return {
      grand_total: 0,
      part_count: 0,
      material_total: 0,
      labor_total: 0,
      indirect_total: 0,
    }
  }

  const partKeys = bomRows.map((b) => String(b.part_key))
  const { data: parts } = await supabase
    .from('heater_parts_master')
    .select('part_key, cost_price')
    .in('part_key', partKeys)

  const partsMap = new Map(
    (parts || []).map((p) => [
      String(p.part_key),
      {
        cost_price: Number(p.cost_price || 0),
      },
    ])
  )

  let grand_total = 0
  for (const bom of bomRows) {
    const qty = Number(bom.quantity || 1)
    const part = partsMap.get(String(bom.part_key))
    const unit = part?.cost_price || 0
    grand_total += Math.round(unit * qty)
  }

  return {
    grand_total,
    part_count: bomRows.length,
    material_total: grand_total,
    labor_total: 0,
    indirect_total: 0,
  }
}

/**
 * GET /api/heater/models/cost?list=1
 * GET /api/heater/models/cost?model=SGR-600
 *
 * 機種マスタ単位の原価（BOM積み上げ＋紐づく制作指令サマリ）
 */
export async function GET(request: NextRequest) {
  try {
    const listMode = request.nextUrl.searchParams.get('list') === '1'
    const modelCode = request.nextUrl.searchParams.get('model')?.trim() || ''
    const category = request.nextUrl.searchParams.get('category')?.trim() || ''

    const { data: models, error: modelError } = await supabase
      .from('heater_models')
      .select('model, name, product_code, product_category')
      .order('model', { ascending: true })

    if (modelError) {
      return NextResponse.json({ error: modelError.message }, { status: 500 })
    }

    let orderRows: any[] = []
    const ordersRes = await supabase
      .from('work_orders')
      .select(
        'id, order_no, product_name, model, bom_model, qty, heater_model, standard_duration_minutes, assembly_labor_cost, assembly_labor_minutes'
      )
      .order('created_at', { ascending: false })

    if (!ordersRes.error) {
      orderRows = ordersRes.data || []
    } else if (
      !String(ordersRes.error.message || '').includes('heater_model') &&
      !String(ordersRes.error.message || '').includes('assembly_labor')
    ) {
      return NextResponse.json({ error: ordersRes.error.message }, { status: 500 })
    } else {
      const fb = await supabase
        .from('work_orders')
        .select('id, order_no, product_name, model, bom_model, qty, standard_duration_minutes')
        .order('created_at', { ascending: false })
      orderRows = (fb.data || []).map((r) => ({
        ...r,
        heater_model: null,
        assembly_labor_cost: 0,
        assembly_labor_minutes: 0,
      }))
    }

    const heaterRefs = (models || []).map((m) => ({
      model: String(m.model),
      name: m.name ?? null,
    }))
    const { byModel } = groupOrdersByHeaterModel(orderRows, heaterRefs)

    const buildRow = async (m: {
      model: string
      name: string | null
      product_code: string | null
      product_category?: string | null
    }) => {
      const code = String(m.model)
      const bom = await calcBomGrandTotal(code)
      const children = byModel.get(code) || []
      const qtyTotal = children.reduce((s, o) => s + (Number(o.qty) || 0), 0)
      const assemblyLaborAvg =
        children.length > 0
          ? Math.round(
              children.reduce(
                (s, o) =>
                  s +
                  (Number(o.assembly_labor_cost) ||
                    calcLaborCostFromMinutes(Number(o.standard_duration_minutes || 0))),
                0
              ) / children.length
            )
          : 0

      let current_cost_price: number | null = null
      if (m.product_code) {
        const { data: product } = await supabase
          .from('products')
          .select('cost_price')
          .eq('product_code', m.product_code)
          .maybeSingle()
        current_cost_price =
          product?.cost_price != null ? Number(product.cost_price) : null
      }

      const unit_total = bom.grand_total + assemblyLaborAvg

      return {
        model: code,
        name: m.name ?? null,
        product_code: m.product_code ?? null,
        product_category: normalizeProductCategory(
          m.product_category || inferProductCategory(code, m.name)
        ),
        bom_part_count: bom.part_count,
        material_total: bom.material_total,
        bom_labor_total: bom.labor_total,
        indirect_total: bom.indirect_total,
        bom_total: bom.grand_total,
        assembly_labor_total: assemblyLaborAvg,
        unit_total,
        order_count: children.length,
        qty_total: qtyTotal,
        production_total: unit_total * Math.max(qtyTotal, 0),
        current_cost_price,
        linked_orders: children.map((o) => ({
          id: String(o.id),
          order_no: String(o.order_no || ''),
          qty: o.qty == null ? null : Number(o.qty),
          assembly_labor_cost:
            Number(o.assembly_labor_cost) ||
            calcLaborCostFromMinutes(Number(o.standard_duration_minutes || 0)),
        })),
      }
    }

    if (listMode) {
      const filtered = (models || []).filter((m) => {
        if (!category || category === 'すべて') return true
        return (
          normalizeProductCategory(
            m.product_category || inferProductCategory(String(m.model), m.name)
          ) === category
        )
      })
      const rows = []
      for (const m of filtered) {
        rows.push(await buildRow(m))
      }
      const totals = rows.reduce(
        (acc, row) => ({
          bom_total: acc.bom_total + row.bom_total,
          unit_total: acc.unit_total + row.unit_total,
          production_total: acc.production_total + row.production_total,
          order_count: acc.order_count + row.order_count,
          qty_total: acc.qty_total + row.qty_total,
        }),
        { bom_total: 0, unit_total: 0, production_total: 0, order_count: 0, qty_total: 0 }
      )
      return NextResponse.json({ rows, totals })
    }

    if (!modelCode) {
      return NextResponse.json(
        { error: 'model または list=1 が必要です' },
        { status: 400 }
      )
    }

    const target = (models || []).find((m) => String(m.model) === modelCode)
    if (!target) {
      // 機種マスタ未登録でも BOM だけ計算
      const bom = await calcBomGrandTotal(modelCode)
      return NextResponse.json({
        model: modelCode,
        name: null,
        product_code: null,
        product_category: null,
        bom_part_count: bom.part_count,
        material_total: bom.material_total,
        bom_labor_total: bom.labor_total,
        indirect_total: bom.indirect_total,
        bom_total: bom.grand_total,
        assembly_labor_total: 0,
        unit_total: bom.grand_total,
        order_count: 0,
        qty_total: 0,
        production_total: 0,
        current_cost_price: null,
        linked_orders: [],
        registered_in_master: false,
      })
    }

    const row = await buildRow(target)
    return NextResponse.json({ ...row, registered_in_master: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '機種原価の取得に失敗しました'
    console.error('heater models cost GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
