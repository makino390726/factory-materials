import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const PAGE_SIZE = 1000
const UPDATE_CHUNK = 80

type CostItemRow = {
  id: string
  master_id: string | null
  work_order_cost_id: string | null
  material_cost: number | null
  labor_cost: number | null
  indirect_cost: number | null
  line_total: number | null
}

type CostHeaderRow = {
  id: string
  total_material_cost: number | null
  total_labor_cost: number | null
  total_indirect_cost: number | null
  total_cost: number | null
  updated_at: string | null
  created_at: string | null
}

/**
 * POST /api/heater/parts-master/recalculate
 * 1) 明細の line_total を 材料+工賃+間接 で再計算
 * 2) 最新ヘッダ合計を明細合計に合わせて更新
 * 3) パーツマスタの材料費・間接費・原価合計を再集計
 */
export async function POST(_req: NextRequest) {
  try {
    const allItems: CostItemRow[] = []
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('work_order_cost_items')
        .select(
          'id, master_id, work_order_cost_id, material_cost, labor_cost, indirect_cost, line_total'
        )
        .eq('master_type', 'ライン原価')
        .range(from, from + PAGE_SIZE - 1)
      if (error) {
        return NextResponse.json({ error: `明細取得失敗: ${error.message}` }, { status: 500 })
      }
      const rows = (data || []) as CostItemRow[]
      allItems.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }

    let lineTotalUpdated = 0
    const lineUpdates: Array<{ id: string; line_total: number }> = []
    for (const row of allItems) {
      const material = Number(row.material_cost || 0)
      const labor = Number(row.labor_cost || 0)
      const indirect = Number(row.indirect_cost || 0)
      const nextTotal = material + labor + indirect
      if (Math.abs(Number(row.line_total || 0) - nextTotal) >= 0.5) {
        lineUpdates.push({ id: row.id, line_total: nextTotal })
      }
    }
    for (let i = 0; i < lineUpdates.length; i += UPDATE_CHUNK) {
      const chunk = lineUpdates.slice(i, i + UPDATE_CHUNK)
      await Promise.all(
        chunk.map(async (u) => {
          const { error } = await supabase
            .from('work_order_cost_items')
            .update({ line_total: u.line_total })
            .eq('id', u.id)
          if (!error) lineTotalUpdated += 1
        })
      )
    }

    const headerIds = [
      ...new Set(allItems.map((r) => String(r.work_order_cost_id || '').trim()).filter(Boolean)),
    ]
    const headersById = new Map<string, CostHeaderRow>()
    for (let i = 0; i < headerIds.length; i += UPDATE_CHUNK) {
      const chunk = headerIds.slice(i, i + UPDATE_CHUNK)
      const { data, error } = await supabase
        .from('work_order_costs')
        .select(
          'id, total_material_cost, total_labor_cost, total_indirect_cost, total_cost, updated_at, created_at'
        )
        .in('id', chunk)
      if (error) {
        return NextResponse.json({ error: `ヘッダ取得失敗: ${error.message}` }, { status: 500 })
      }
      for (const h of (data || []) as CostHeaderRow[]) {
        headersById.set(h.id, h)
      }
    }

    const itemsByHeader = new Map<string, CostItemRow[]>()
    for (const row of allItems) {
      const headerId = String(row.work_order_cost_id || '').trim()
      if (!headerId) continue
      const list = itemsByHeader.get(headerId) || []
      list.push(row)
      itemsByHeader.set(headerId, list)
    }

    // パーツごとに最新ヘッダの明細だけを採用
    const headersByPart = new Map<string, Set<string>>()
    for (const row of allItems) {
      const partKey = String(row.master_id || '').trim()
      const headerId = String(row.work_order_cost_id || '').trim()
      if (!partKey || !headerId) continue
      const set = headersByPart.get(partKey) || new Set<string>()
      set.add(headerId)
      headersByPart.set(partKey, set)
    }

    const itemsByPart = new Map<string, { material: number; labor: number; indirect: number }>()
    for (const [partKey, headerSet] of headersByPart) {
      const latestHeaderId = [...headerSet].sort((a, b) => {
        const aTime = String(headersById.get(a)?.updated_at || headersById.get(a)?.created_at || '')
        const bTime = String(headersById.get(b)?.updated_at || headersById.get(b)?.created_at || '')
        return bTime.localeCompare(aTime)
      })[0]
      const rows = (itemsByHeader.get(latestHeaderId) || []).filter(
        (r) => String(r.master_id || '').trim() === partKey
      )
      itemsByPart.set(partKey, {
        material: rows.reduce((s, r) => s + Number(r.material_cost || 0), 0),
        labor: rows.reduce((s, r) => s + Number(r.labor_cost || 0), 0),
        indirect: rows.reduce((s, r) => s + Number(r.indirect_cost || 0), 0),
      })
    }

    // ヘッダを明細合計に合わせる（二重計上の元を消す）
    let headersUpdated = 0
    const headerUpdates: Array<{
      id: string
      total_material_cost: number
      total_labor_cost: number
      total_indirect_cost: number
      total_cost: number
    }> = []
    for (const [headerId, rows] of itemsByHeader) {
      const material = rows.reduce((s, r) => s + Number(r.material_cost || 0), 0)
      const labor = rows.reduce((s, r) => s + Number(r.labor_cost || 0), 0)
      const indirect = rows.reduce((s, r) => s + Number(r.indirect_cost || 0), 0)
      const total = material + labor + indirect
      const header = headersById.get(headerId)
      if (
        !header ||
        Math.abs(Number(header.total_material_cost || 0) - material) >= 0.5 ||
        Math.abs(Number(header.total_labor_cost || 0) - labor) >= 0.5 ||
        Math.abs(Number(header.total_indirect_cost || 0) - indirect) >= 0.5 ||
        Math.abs(Number(header.total_cost || 0) - total) >= 0.5
      ) {
        headerUpdates.push({
          id: headerId,
          total_material_cost: material,
          total_labor_cost: labor,
          total_indirect_cost: indirect,
          total_cost: total,
        })
      }
    }
    for (let i = 0; i < headerUpdates.length; i += UPDATE_CHUNK) {
      const chunk = headerUpdates.slice(i, i + UPDATE_CHUNK)
      await Promise.all(
        chunk.map(async (u) => {
          const { error } = await supabase
            .from('work_order_costs')
            .update({
              total_material_cost: u.total_material_cost,
              total_labor_cost: u.total_labor_cost,
              total_indirect_cost: u.total_indirect_cost,
              total_cost: u.total_cost,
              updated_at: new Date().toISOString(),
            })
            .eq('id', u.id)
          if (!error) headersUpdated += 1
        })
      )
    }

    const { data: allParts, error: fetchError } = await supabase
      .from('heater_parts_master')
      .select('part_key, material_cost_total, indirect_cost_total, cost_price')

    if (fetchError) {
      return NextResponse.json({ error: `パーツ取得失敗: ${fetchError.message}` }, { status: 500 })
    }

    let updatedCount = 0
    let skippedCount = 0
    for (const part of allParts || []) {
      const summary = itemsByPart.get(part.part_key)
      if (!summary) {
        skippedCount += 1
        continue
      }
      const materialCost = Math.round(summary.material)
      const laborCost = Math.round(summary.labor)
      const indirectCost = Math.round(summary.indirect)
      const totalCost = materialCost + laborCost + indirectCost

      const beforeMaterial = Number(part.material_cost_total || 0)
      const beforeIndirect = Number(part.indirect_cost_total || 0)
      const beforeTotal = Number(part.cost_price || 0)
      if (
        beforeMaterial === materialCost &&
        beforeIndirect === indirectCost &&
        beforeTotal === totalCost
      ) {
        continue
      }

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

    return NextResponse.json({
      success: true,
      message: '材料費・工賃・間接費・合計を再計算しました',
      totalParts: (allParts || []).length,
      updatedCount,
      skippedCount,
      lineTotalUpdated,
      headersUpdated,
      note:
        skippedCount > 0
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
