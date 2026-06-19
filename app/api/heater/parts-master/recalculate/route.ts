import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * POST /api/heater/parts-master/recalculate
 * 全パーツマスタの材料費・間接費・原価（合計）を再集計して更新
 */
export async function POST(req: NextRequest) {
  try {
    // 全パーツマスタを取得
    const { data: allParts, error: fetchError } = await supabase
      .from('heater_parts_master')
      .select('part_key, material_cost_total, indirect_cost_total, cost_price')

    if (fetchError) {
      console.error('fetch parts error:', fetchError)
      return NextResponse.json({ error: `fetch failed: ${fetchError.message}` }, { status: 500 })
    }

    if (!allParts || allParts.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: '更新対象のパーツがありません', 
        updatedCount: 0 
      })
    }

    // 原価明細を取得し、part_key(master_id)ごとに材料費・間接費を集計
    const { data: costItems, error: costItemsError } = await supabase
      .from('work_order_cost_items')
      .select('master_id, material_cost, indirect_cost')
      .eq('master_type', 'ライン原価')

    if (costItemsError) {
      console.error('fetch cost items error:', costItemsError)
      return NextResponse.json({ error: `fetch failed: ${costItemsError.message}` }, { status: 500 })
    }

    const summaryMap: Record<string, { material: number; indirect: number }> = {}

    for (const row of costItems || []) {
      const key = row.master_id || ''
      if (!key) continue

      if (!summaryMap[key]) {
        summaryMap[key] = { material: 0, indirect: 0 }
      }

      summaryMap[key].material += Number(row.material_cost || 0)
      summaryMap[key].indirect += Number(row.indirect_cost || 0)
    }

    let updatedCount = 0
    let skippedCount = 0

    // 各パーツについて、材料費・間接費・原価（合計）を再計算して更新
    for (const part of allParts) {
      const summary = summaryMap[part.part_key]
      
      // work_order_cost_itemsにデータが存在しないパーツはスキップ（既存の値を保持）
      if (!summary) {
        skippedCount += 1
        continue
      }

      const materialCost = Number(summary.material || 0)
      const indirectCost = Number(summary.indirect || 0)
      const totalCost = materialCost + indirectCost

      const beforeMaterial = Number(part.material_cost_total || 0)
      const beforeIndirect = Number(part.indirect_cost_total || 0)
      const beforeTotal = Number(part.cost_price || 0)

      // いずれかが異なる場合のみ更新
      if (beforeMaterial !== materialCost || beforeIndirect !== indirectCost || beforeTotal !== totalCost) {
        const { error: updateError } = await supabase
          .from('heater_parts_master')
          .update({
            material_cost_total: materialCost,
            indirect_cost_total: indirectCost,
            cost_price: totalCost,
          })
          .eq('part_key', part.part_key)

        if (updateError) {
          console.error('update part error:', { part_key: part.part_key, error: updateError })
          continue
        }

        updatedCount += 1
      }
    }

    return NextResponse.json({
      success: true,
      message: `材料費・間接費・原価（合計）を再計算しました`,
      totalParts: allParts.length,
      updatedCount,
      skippedCount,
      note: skippedCount > 0 
        ? `${skippedCount}件のパーツはL指令原価データが存在しないため、既存の値を保持しました`
        : undefined,
    })
  } catch (err) {
    console.error('recalculate error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
