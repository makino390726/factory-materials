import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  aggregateWorkOrderSavedCost,
  listWorkOrderBomSummaries,
} from '@/lib/work-order-bom-cost-aggregate'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/work-orders/bom-cost?work_order_id=xxx
 * GET /api/work-orders/bom-cost?list=1&filter=bom|all
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const listMode = searchParams.get('list') === '1'

    if (listMode) {
      const filter = searchParams.get('filter') === 'all' ? 'all' : 'bom'
      const result = await listWorkOrderBomSummaries(supabase, filter)
      return NextResponse.json(result)
    }

    const work_order_id = searchParams.get('work_order_id')
    if (!work_order_id) {
      return NextResponse.json({ error: 'work_order_id は必須です' }, { status: 400 })
    }

    const { data: wo, error: woErr } = await supabase
      .from('work_orders')
      .select('id, order_no, product_name, model, bom_model, cost_mode, qty, standard_duration_minutes')
      .eq('id', work_order_id)
      .maybeSingle()

    if (woErr || !wo) {
      return NextResponse.json({ error: 'D指令が見つかりません' }, { status: 404 })
    }

    const { data: branches, error: brErr } = await supabase
      .from('work_order_branches')
      .select('*')
      .eq('work_order_id', work_order_id)
      .order('branch_no', { ascending: true })

    if (brErr) {
      return NextResponse.json({ error: brErr.message }, { status: 500 })
    }

    const result = await aggregateWorkOrderSavedCost(supabase, wo, branches || [])

    return NextResponse.json({
      work_order: wo,
      grand_total: result.grand_total,
      material_total: result.material_total,
      labor_total: result.labor_total,
      indirect_total: result.indirect_total,
      branches: result.branches,
      has_saved_cost: result.has_saved_cost,
      cost_saved_at: result.cost_saved_at,
      order_labor_cost: 0,
    })
  } catch (err) {
    console.error('bom-cost GET error:', err)
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

/**
 * POST /api/work-orders/bom-cost
 * 現在の枝番合計を work_order_costs に保存（スナップショット）
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { work_order_id } = body

    if (!work_order_id) {
      return NextResponse.json({ error: 'work_order_id は必須です' }, { status: 400 })
    }

    const { data: wo } = await supabase
      .from('work_orders')
      .select('id, order_no, cost_mode, standard_duration_minutes')
      .eq('id', work_order_id)
      .maybeSingle()

    if (!wo) {
      return NextResponse.json({ error: 'D指令が見つかりません' }, { status: 404 })
    }

    const { data: branches } = await supabase
      .from('work_order_branches')
      .select('*')
      .eq('work_order_id', work_order_id)
      .order('branch_no', { ascending: true })

    const branchesTotalCost = (branches || []).reduce(
      (sum: number, b: any) => sum + (Number(b.subtotal) || 0),
      0
    )

    const LABOR_RATE_PER_MINUTE = 100
    const orderLaborCost = Math.round((wo.standard_duration_minutes || 0) * LABOR_RATE_PER_MINUTE)
    const totalCost = branchesTotalCost + orderLaborCost

    const now = new Date().toISOString()

    const { data: existing } = await supabase
      .from('work_order_costs')
      .select('id')
      .eq('work_order_id', work_order_id)
      .maybeSingle()

    let costHeader: any
    if (existing) {
      const { data: updated } = await supabase
        .from('work_order_costs')
        .update({
          total_cost: totalCost,
          total_material_cost: totalCost,
          total_labor_cost: 0,
          total_indirect_cost: 0,
          cost_mode: 'bom',
          branch_count: (branches || []).length,
          last_bom_sync: now,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select()
        .maybeSingle()
      costHeader = updated
    } else {
      const { data: inserted } = await supabase
        .from('work_order_costs')
        .insert({
          work_order_id,
          order_no: wo.order_no,
          total_cost: totalCost,
          total_material_cost: totalCost,
          total_labor_cost: 0,
          total_indirect_cost: 0,
          cost_mode: 'bom',
          branch_count: (branches || []).length,
          last_bom_sync: now,
          created_at: now,
          updated_at: now,
        })
        .select()
        .maybeSingle()
      costHeader = inserted
    }

    return NextResponse.json({
      success: true,
      total_cost: totalCost,
      branch_count: (branches || []).length,
      cost_header: costHeader,
    })
  } catch (err) {
    console.error('bom-cost POST error:', err)
    return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
  }
}
