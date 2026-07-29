import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  DEFAULT_PRODUCT_CATEGORY,
  inferProductCategory,
  normalizeProductCategory,
} from '@/lib/product-category'
import { calcAssemblyLaborFromMinutes } from '@/lib/work-order-assembly-labor'
import { groupOrdersByHeaterModel } from '@/lib/heater-model-order-match'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function loadOrders() {
  const { data: orders, error: orderError } = await supabase
    .from('work_orders')
    .select(
      'id, order_no, product_name, model, bom_model, qty, status, standard_duration_minutes, heater_model, assembly_labor_minutes, assembly_labor_cost, current_period_minutes, labor_receipt_date, cost_mode, created_at'
    )
    .order('created_at', { ascending: false })

  if (!orderError) return { orderRows: orders || [], missingColumn: false }

  if (
    String(orderError.message || '').includes('heater_model') ||
    String(orderError.message || '').includes('assembly_labor')
  ) {
    const fallback = await supabase
      .from('work_orders')
      .select(
        'id, order_no, product_name, model, bom_model, qty, status, standard_duration_minutes, cost_mode, created_at'
      )
      .order('created_at', { ascending: false })
    if (fallback.error) throw fallback.error
    const orderRows = (fallback.data || []).map((row) => {
      const labor = calcAssemblyLaborFromMinutes(Number(row.standard_duration_minutes || 0))
      return {
        ...row,
        heater_model: null as string | null,
        assembly_labor_minutes: labor.assembly_labor_minutes,
        assembly_labor_cost: labor.assembly_labor_cost,
        current_period_minutes: 0,
        labor_receipt_date: null as string | null,
      }
    })
    return { orderRows, missingColumn: true }
  }
  throw orderError
}

function mapChild(o: any, matchExplicit: boolean) {
  const minutes =
    Number(o.assembly_labor_minutes || 0) > 0
      ? Number(o.assembly_labor_minutes || 0)
      : Number(o.standard_duration_minutes || 0)
  const labor =
    Number(o.assembly_labor_cost || 0) > 0
      ? Number(o.assembly_labor_cost || 0)
      : calcAssemblyLaborFromMinutes(minutes).assembly_labor_cost
  return {
    id: String(o.id),
    order_no: String(o.order_no || ''),
    product_name: o.product_name ?? null,
    model: o.model ?? null,
    qty: o.qty == null ? null : Number(o.qty),
    status: o.status ?? null,
    standard_duration_minutes: Number(o.standard_duration_minutes || 0),
    assembly_labor_minutes: minutes,
    assembly_labor_cost: labor,
    current_period_minutes: Number(o.current_period_minutes || 0),
    labor_receipt_date: o.labor_receipt_date ? String(o.labor_receipt_date) : null,
    linked_explicitly: matchExplicit,
    match_reason: o._match?.reason ?? null,
    cost_mode: o.cost_mode ?? null,
  }
}

/**
 * GET /api/heater/model-orders
 * 機種（親）配下の制作指令一覧（階層マスタ用）
 * 型式・BOM・製品名が機種マスタと一致するものを自動振り分け
 */
export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get('category')?.trim() || ''
    const q = request.nextUrl.searchParams.get('q')?.trim() || ''

    const { data: models, error: modelError } = await supabase
      .from('heater_models')
      .select('model, name, product_code, product_category')
      .order('model', { ascending: true })

    if (modelError) {
      return NextResponse.json({ error: modelError.message }, { status: 500 })
    }

    const { orderRows } = await loadOrders()
    const heaterRefs = (models || []).map((m) => ({
      model: String(m.model),
      name: m.name ?? null,
    }))
    const { byModel, unlinked } = groupOrdersByHeaterModel(orderRows, heaterRefs)

    const tree = (models || [])
      .map((m) => {
        const productCategory = normalizeProductCategory(
          m.product_category || inferProductCategory(String(m.model), m.name)
        )
        const childrenRaw = byModel.get(String(m.model)) || []
        const children = childrenRaw.map((o) =>
          mapChild(o, Boolean(o._match?.explicit || o._match?.reason === 'heater_model'))
        )

        const qtyTotal = children.reduce((sum, c) => sum + (c.qty || 0), 0)
        const minutesTotal = children.reduce(
          (sum, c) => sum + (c.standard_duration_minutes || 0),
          0
        )

        return {
          model: String(m.model),
          name: m.name ?? null,
          product_code: m.product_code ?? null,
          product_category: productCategory,
          order_count: children.length,
          qty_total: qtyTotal,
          minutes_total: minutesTotal,
          orders: children,
        }
      })
      .filter((node) => {
        if (category && category !== 'すべて' && node.product_category !== category) {
          return false
        }
        if (!q) return true
        const needle = q.toLowerCase()
        if (node.model.toLowerCase().includes(needle)) return true
        if ((node.name || '').toLowerCase().includes(needle)) return true
        return node.orders.some(
          (o) =>
            o.order_no.toLowerCase().includes(needle) ||
            (o.product_name || '').toLowerCase().includes(needle)
        )
      })

    const unlinkedMapped = unlinked.map((o) => mapChild(o, false))

    const linkableCount = tree.reduce(
      (sum, node) =>
        sum + node.orders.filter((o) => !o.linked_explicitly).length,
      0
    )

    return NextResponse.json({
      models: tree,
      unlinked_orders: unlinkedMapped,
      linkable_count: linkableCount,
      defaults: { product_category: DEFAULT_PRODUCT_CATEGORY },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '取得に失敗しました'
    console.error('model-orders GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST action=auto_link
 * 機種コード／品名が一致するD指令の heater_model を一括設定
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '')
    if (action !== 'auto_link') {
      return NextResponse.json({ error: '不明な action です' }, { status: 400 })
    }

    const { data: models, error: modelError } = await supabase
      .from('heater_models')
      .select('model, name')
      .order('model', { ascending: true })
    if (modelError) {
      return NextResponse.json({ error: modelError.message }, { status: 500 })
    }

    const { orderRows, missingColumn } = await loadOrders()
    if (missingColumn) {
      return NextResponse.json(
        {
          error:
            'heater_model 列がありません。Supabaseで migrate-add-work-order-heater-model-labor.sql を実行してください。',
        },
        { status: 500 }
      )
    }

    const heaterRefs = (models || []).map((m) => ({
      model: String(m.model),
      name: m.name ?? null,
    }))
    const { byModel } = groupOrdersByHeaterModel(orderRows, heaterRefs)

    let updated = 0
    let skipped = 0
    const now = new Date().toISOString()
    const details: Array<{ order_no: string; heater_model: string; reason: string }> = []

    for (const [modelCode, children] of byModel.entries()) {
      for (const order of children) {
        if (order.heater_model && String(order.heater_model) === modelCode) {
          skipped += 1
          continue
        }
        // 既に別機種へ明示紐づけ済みなら上書きしない
        if (order.heater_model && String(order.heater_model) !== modelCode) {
          skipped += 1
          continue
        }
        const { error } = await supabase
          .from('work_orders')
          .update({
            heater_model: modelCode,
            updated_at: now,
          })
          .eq('id', order.id)
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        updated += 1
        details.push({
          order_no: String(order.order_no || ''),
          heater_model: modelCode,
          reason: order._match?.reason || 'auto',
        })
      }
    }

    return NextResponse.json({
      success: true,
      updated,
      skipped,
      details,
      message: `機種マスタと一致するD指令 ${updated} 件を親機種へ振り分けました（スキップ ${skipped} 件）`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '振り分けに失敗しました'
    console.error('model-orders POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
