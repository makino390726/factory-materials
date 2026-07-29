import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  aggregateWorkOrderSavedCost,
  listWorkOrderBomSummaries,
} from '@/lib/work-order-bom-cost-aggregate'
import { calcLaborCostFromMinutes } from '@/lib/line-part-labor-cost'
import { calcAssemblyLaborFromMinutes } from '@/lib/work-order-assembly-labor'

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
      .select(
        'id, order_no, product_name, model, bom_model, cost_mode, qty, standard_duration_minutes, heater_model, assembly_labor_minutes, assembly_labor_cost, current_period_minutes, labor_receipt_date'
      )
      .eq('id', work_order_id)
      .maybeSingle()

    if (woErr || !wo) {
      // 列未追加環境向けフォールバック
      const fallback = await supabase
        .from('work_orders')
        .select('id, order_no, product_name, model, bom_model, cost_mode, qty, standard_duration_minutes')
        .eq('id', work_order_id)
        .maybeSingle()
      if (fallback.error || !fallback.data) {
        return NextResponse.json({ error: 'D指令が見つかりません' }, { status: 404 })
      }
      const labor = calcAssemblyLaborFromMinutes(
        Number(fallback.data.standard_duration_minutes || 0)
      )
      Object.assign(fallback.data, {
        heater_model: null,
        assembly_labor_minutes: labor.assembly_labor_minutes,
        assembly_labor_cost: labor.assembly_labor_cost,
        current_period_minutes: 0,
        labor_receipt_date: null,
      })
      const { data: branchesFb, error: brErrFb } = await supabase
        .from('work_order_branches')
        .select('*')
        .eq('work_order_id', work_order_id)
        .order('branch_no', { ascending: true })
      if (brErrFb) {
        return NextResponse.json({ error: brErrFb.message }, { status: 500 })
      }
      const resultFb = await aggregateWorkOrderSavedCost(supabase, fallback.data, branchesFb || [])
      const bomLabor = resultFb.labor_total
      const assemblyLabor = labor.assembly_labor_cost
      return NextResponse.json({
        work_order: fallback.data,
        grand_total: resultFb.grand_total + assemblyLabor,
        material_total: resultFb.material_total,
        labor_total: bomLabor + assemblyLabor,
        bom_labor_total: bomLabor,
        assembly_labor_total: assemblyLabor,
        assembly_labor_minutes: labor.assembly_labor_minutes,
        indirect_total: resultFb.indirect_total,
        branches: resultFb.branches,
        has_saved_cost: resultFb.has_saved_cost,
        cost_saved_at: resultFb.cost_saved_at,
        order_labor_cost: assemblyLabor,
      })
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

    const assemblyMinutes =
      Number(wo.assembly_labor_minutes || 0) > 0
        ? Number(wo.assembly_labor_minutes || 0)
        : Number(wo.standard_duration_minutes || 0)
    const assemblyLabor =
      Number(wo.assembly_labor_cost || 0) > 0
        ? Number(wo.assembly_labor_cost || 0)
        : calcLaborCostFromMinutes(assemblyMinutes)
    const bomLabor = result.labor_total

    return NextResponse.json({
      work_order: wo,
      grand_total: result.grand_total + (result.has_saved_cost ? 0 : assemblyLabor),
      // 保存済み原価に制作工賃が含まれていない場合は表示上加算
      material_total: result.material_total,
      labor_total: bomLabor + (result.has_saved_cost ? 0 : assemblyLabor),
      bom_labor_total: bomLabor,
      assembly_labor_total: assemblyLabor,
      assembly_labor_minutes: assemblyMinutes,
      indirect_total: result.indirect_total,
      branches: result.branches,
      has_saved_cost: result.has_saved_cost,
      cost_saved_at: result.cost_saved_at,
      order_labor_cost: assemblyLabor,
    })
  } catch (err) {
    console.error('bom-cost GET error:', err)
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

/**
 * POST /api/work-orders/bom-cost
 * 現在の枝番合計＋制作工賃を work_order_costs に保存（スナップショット）
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { work_order_id } = body

    if (!work_order_id) {
      return NextResponse.json({ error: 'work_order_id は必須です' }, { status: 400 })
    }

    let wo: any = null
    const primary = await supabase
      .from('work_orders')
      .select(
        'id, order_no, cost_mode, standard_duration_minutes, assembly_labor_minutes, assembly_labor_cost'
      )
      .eq('id', work_order_id)
      .maybeSingle()
    if (primary.error && String(primary.error.message || '').includes('assembly_labor')) {
      const fallback = await supabase
        .from('work_orders')
        .select('id, order_no, cost_mode, standard_duration_minutes')
        .eq('id', work_order_id)
        .maybeSingle()
      wo = fallback.data
    } else {
      wo = primary.data
    }

    if (!wo) {
      return NextResponse.json({ error: 'D指令が見つかりません' }, { status: 404 })
    }

    const { data: branches } = await supabase
      .from('work_order_branches')
      .select('*')
      .eq('work_order_id', work_order_id)
      .order('branch_no', { ascending: true })

    const aggregated = await aggregateWorkOrderSavedCost(supabase, wo, branches || [])

    const assemblyMinutes =
      Number(wo.assembly_labor_minutes || 0) > 0
        ? Number(wo.assembly_labor_minutes || 0)
        : Number(wo.standard_duration_minutes || 0)
    const assemblyLabor =
      Number(wo.assembly_labor_cost || 0) > 0
        ? Number(wo.assembly_labor_cost || 0)
        : calcLaborCostFromMinutes(assemblyMinutes)

    // 保存済み明細がある場合はその材料・BOM工賃・間接費を使い、制作工賃を加算
    const materialTotal = aggregated.has_saved_cost
      ? aggregated.material_total
      : (branches || []).reduce((sum: number, b: any) => sum + (Number(b.subtotal) || 0), 0)
    const bomLaborTotal = aggregated.has_saved_cost ? aggregated.labor_total : 0
    const indirectTotal = aggregated.has_saved_cost ? aggregated.indirect_total : 0
    const laborTotal = bomLaborTotal + assemblyLabor
    const totalCost = aggregated.has_saved_cost
      ? aggregated.material_total + laborTotal + aggregated.indirect_total
      : materialTotal + assemblyLabor

    const now = new Date().toISOString()

    const { data: existing } = await supabase
      .from('work_order_costs')
      .select('id')
      .eq('work_order_id', work_order_id)
      .maybeSingle()

    const headerPayload = {
      total_cost: totalCost,
      total_material_cost: aggregated.has_saved_cost ? materialTotal : totalCost - assemblyLabor,
      total_labor_cost: laborTotal,
      total_indirect_cost: indirectTotal,
      cost_mode: 'bom',
      branch_count: (branches || []).length,
      last_bom_sync: now,
      updated_at: now,
    }

    let costHeader: any
    if (existing) {
      const { data: updated } = await supabase
        .from('work_order_costs')
        .update(headerPayload)
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
          ...headerPayload,
          created_at: now,
        })
        .select()
        .maybeSingle()
      costHeader = inserted
    }

    return NextResponse.json({
      success: true,
      total_cost: totalCost,
      bom_labor_total: bomLaborTotal,
      assembly_labor_total: assemblyLabor,
      assembly_labor_minutes: assemblyMinutes,
      labor_total: laborTotal,
      branch_count: (branches || []).length,
      cost_header: costHeader,
    })
  } catch (err) {
    console.error('bom-cost POST error:', err)
    return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
  }
}
