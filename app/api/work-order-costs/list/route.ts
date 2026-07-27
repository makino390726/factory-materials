import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 原価保存済みD指令一覧（過去原価準用の候補用） */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('work_order_costs')
      .select(
        'id, work_order_id, order_no, total_cost, total_material_cost, total_labor_cost, total_indirect_cost, updated_at, created_at'
      )
      .not('work_order_id', 'is', null)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('work_order_costs list error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // work_order_id ごとに最新1件
    const latestByWorkOrder = new Map<string, (typeof data)[number]>()
    for (const row of data || []) {
      const workOrderId = String(row.work_order_id || '').trim()
      if (!workOrderId || latestByWorkOrder.has(workOrderId)) continue
      latestByWorkOrder.set(workOrderId, row)
    }

    const workOrderIds = Array.from(latestByWorkOrder.keys())
    let orderMeta = new Map<
      string,
      {
        order_no: string
        product_name: string | null
        model: string | null
        bom_model: string | null
        cost_mode: string | null
      }
    >()

    if (workOrderIds.length > 0) {
      const { data: orders, error: ordersError } = await supabase
        .from('work_orders')
        .select('id, order_no, product_name, model, bom_model, cost_mode')
        .in('id', workOrderIds)

      if (ordersError) {
        console.error('work_orders meta for cost list error:', ordersError)
      } else {
        orderMeta = new Map(
          (orders || []).map((row) => [
            String(row.id),
            {
              order_no: String(row.order_no || ''),
              product_name: row.product_name ?? null,
              model: row.model ?? null,
              bom_model: row.bom_model ?? null,
              cost_mode: row.cost_mode ?? null,
            },
          ])
        )
      }
    }

    const rows = Array.from(latestByWorkOrder.entries()).map(([work_order_id, cost]) => {
      const meta = orderMeta.get(work_order_id)
      return {
        id: cost.id,
        work_order_id,
        order_no: meta?.order_no || cost.order_no || '',
        product_name: meta?.product_name ?? null,
        model: meta?.model ?? null,
        bom_model: meta?.bom_model ?? null,
        cost_mode: meta?.cost_mode ?? null,
        total_cost: Number(cost.total_cost || 0),
        total_material_cost: Number(cost.total_material_cost || 0),
        total_labor_cost: Number(cost.total_labor_cost || 0),
        total_indirect_cost: Number(cost.total_indirect_cost || 0),
        updated_at: cost.updated_at,
        created_at: cost.created_at,
      }
    })

    rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

    return NextResponse.json(rows)
  } catch (err) {
    console.error('work_order_costs list unexpected error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
