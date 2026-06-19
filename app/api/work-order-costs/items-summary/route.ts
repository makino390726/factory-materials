import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// L指令原価の明細を part_key (master_id) 単位で集計
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const persist = url.searchParams.get('persist') === '1'
    const partKey = url.searchParams.get('part_key')

    let query = supabase
      .from('work_order_cost_items')
      .select('master_id, material_cost, indirect_cost, labor_cost, line_total')
      .eq('master_type', 'ライン原価')

    if (partKey) {
      query = query.eq('master_id', partKey)
    }

    const { data, error } = await query

    if (error) {
      console.error('items-summary fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const summaryMap: Record<string, { part_key: string; material_cost_total: number; indirect_cost_total: number; total_cost: number }> = {}

    ;(data || []).forEach((row: any) => {
      const key = row.master_id || ''
      if (!key) return

      if (!summaryMap[key]) {
        summaryMap[key] = { part_key: key, material_cost_total: 0, indirect_cost_total: 0, total_cost: 0 }
      }

      const material = Number(row.material_cost || 0)
      const indirect = Number(row.indirect_cost || 0)
      const lineTotal = Number(row.line_total || 0)

      summaryMap[key].material_cost_total += material
      summaryMap[key].indirect_cost_total += indirect
      summaryMap[key].total_cost += lineTotal
    })

    const summaryList = Object.values(summaryMap)

    if (persist && summaryList.length > 0) {
      for (const item of summaryList) {
        const { error: updateError } = await supabase
          .from('heater_parts_master')
          .update({
            material_cost_total: item.material_cost_total,
            indirect_cost_total: item.indirect_cost_total,
            cost_price: item.material_cost_total + item.indirect_cost_total,
          })
          .eq('part_key', item.part_key)

        if (updateError) {
          console.error('items-summary persist error:', { part_key: item.part_key, error: updateError })
        }
      }
    }

    return NextResponse.json(summaryList)
  } catch (err) {
    console.error('items-summary error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
