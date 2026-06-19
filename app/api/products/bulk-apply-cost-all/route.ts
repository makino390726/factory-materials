import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  computeCostLineFromMasterUnitPrice,
  rollupWorkOrderCostHeaders,
} from '@/lib/work-order-cost-from-product-master'

export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CHUNK_SIZE = 10
/** Supabase/PostgREST の既定行上限（1クエリあたり）。超えるデータは range でページングする */
const PAGE_SIZE = 1000

/**
 * POST /api/products/bulk-apply-cost-all
 * products.cost_price を全 work_order_cost_items（D指令原価・L指令原価）の
 * unit_price に一括反映し、material_cost / indirect_cost / line_total を再計算する。
 *
 * リクエストボディ: { execute?: boolean }
 *   - execute=true でDB更新も実行（デフォルトはプレビューのみ）
 *
 * スキップ条件:
 *   - product_code が products に未登録
 *   - products.cost_price が null / 0 / 非数値
 *   - 現在の unit_price が既に products.cost_price と一致
 */
export async function POST(req: Request) {
  let body = { execute: false }
  try {
    body = await req.json()
  } catch {
    body = { execute: false }
  }
  try {
    // 1. 製品マスタ全件取得（1,000件上限を超える場合はページング）
    const productsData: { product_code: string | null; cost_price: number | null }[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: batch, error: prodError } = await supabase
        .from('products')
        .select('product_code, cost_price')
        .order('product_code', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      if (prodError) {
        return NextResponse.json({ error: prodError.message }, { status: 500 })
      }

      const rows = batch || []
      productsData.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }

    const productCodeSet = new Set<string>()
    const productCostMap = new Map<string, number | null>()
    for (const p of productsData || []) {
      const code = String(p.product_code || '').trim()
      if (code) {
        productCodeSet.add(code)
        productCostMap.set(code, p.cost_price != null ? Number(p.cost_price) : null)
      }
    }

    // 2. 全 work_order_cost_items (product_code あり) を取得（1,000件上限を超える場合はページング）
    type CostItemRow = {
      id: string
      work_order_cost_id: string
      line_no: number
      product_code: string | null
      part_name: string | null
      quantity: number | null
      unit_price: number | null
      labor_cost: number | null
      material_cost: number | null
      indirect_cost: number | null
      line_total: number | null
      cost_type: string | null
      master_type: string | null
      master_id: string | null
    }

    const allItems: CostItemRow[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: batch, error: itemsError } = await supabase
        .from('work_order_cost_items')
        .select(
          'id, work_order_cost_id, line_no, product_code, part_name, quantity, unit_price, labor_cost, material_cost, indirect_cost, line_total, cost_type, master_type, master_id'
        )
        .not('product_code', 'is', null)
        .neq('product_code', '')
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      if (itemsError) {
        return NextResponse.json({ error: itemsError.message }, { status: 500 })
      }

      const rows = (batch || []) as CostItemRow[]
      allItems.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }

    // 3. 分類
    type UpdateTarget = {
      id: string
      work_order_cost_id: string
      line_no: number
      product_code: string
      part_name: string | null
      old_unit_price: number
      new_unit_price: number
      quantity: number
      labor_cost: number
      cost_type: string
      master_type: string | null
      master_id: string | null
      new_material_cost: number
      new_indirect_cost: number
      new_line_total: number
    }

    const toUpdate: UpdateTarget[] = []
    let skippedNoProduct = 0
    let skippedNoCost = 0
    let unchanged = 0

    for (const item of allItems) {
      const code = String(item.product_code || '').trim()
      if (!code) {
        unchanged++
        continue
      }

      if (!productCodeSet.has(code)) {
        skippedNoProduct++
        continue
      }

      const productCost = productCostMap.get(code) ?? null
      if (productCost === null || !Number.isFinite(productCost) || productCost === 0) {
        skippedNoCost++
        continue
      }

      const oldPrice = Number(item.unit_price || 0)
      if (Math.abs(oldPrice - productCost) < 1e-9) {
        unchanged++
        continue
      }

      const qty = Number(item.quantity || 0)
      const labor = Number(item.labor_cost || 0)
      const costType = item.cost_type || '加'
      const line = computeCostLineFromMasterUnitPrice({
        productCost,
        quantity: item.quantity,
        labor_cost: item.labor_cost,
        cost_type: item.cost_type,
      })

      toUpdate.push({
        id: item.id,
        work_order_cost_id: item.work_order_cost_id,
        line_no: item.line_no,
        product_code: code,
        part_name: item.part_name || null,
        old_unit_price: oldPrice,
        new_unit_price: line.unit_price,
        quantity: qty,
        labor_cost: labor,
        cost_type: costType,
        master_type: item.master_type || null,
        master_id: item.master_id || null,
        new_material_cost: line.material_cost,
        new_indirect_cost: line.indirect_cost,
        new_line_total: line.line_total,
      })
    }

    // 4. プレビューようの詳細情報を構築
    const previewDetails = toUpdate.slice(0, 500).map((item) => ({
      product_code: item.product_code,
      part_name: item.part_name,
      old_unit_price: item.old_unit_price,
      new_unit_price: item.new_unit_price,
    }))

    // プレビューモードの場合はここで返す
    if (!body.execute) {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        summary: {
          totalScanned: allItems.length,
          updated: toUpdate.length,
          skippedNoProduct,
          skippedNoCost,
          unchanged,
          affectedWorkOrders: Array.from(new Set(toUpdate.map((x) => x.work_order_cost_id))).length,
        },
        previewDetails,
        preview_truncated: toUpdate.length > 500,
      })
    }

    // 5. 実行モード：DB更新を実行
    for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
      const chunk = toUpdate.slice(i, i + CHUNK_SIZE)
      await Promise.all(
        chunk.map((item) =>
          supabase
            .from('work_order_cost_items')
            .update({
              unit_price: item.new_unit_price,
              material_cost: item.new_material_cost,
              indirect_cost: item.new_indirect_cost,
              line_total: item.new_line_total,
            })
            .eq('id', item.id)
        )
      )
    }

    // 5. 影響を受けた work_order_costs ヘッダを再集計
    const affectedCostIds = Array.from(new Set(toUpdate.map((x) => x.work_order_cost_id)))

    await rollupWorkOrderCostHeaders(supabase, affectedCostIds)

    // 6. レポート用に order_no を取得
    const orderNoMap = new Map<string, string>()
    for (let i = 0; i < affectedCostIds.length; i += 100) {
      const chunk = affectedCostIds.slice(i, i + 100)
      const { data: headers } = await supabase
        .from('work_order_costs')
        .select('id, order_no')
        .in('id', chunk)

      for (const h of headers || []) {
        orderNoMap.set(h.id, h.order_no || '')
      }
    }

    // 詳細リスト（最大500件）
    const details = toUpdate.slice(0, 500).map((item) => ({
      order_no: orderNoMap.get(item.work_order_cost_id) || '',
      work_order_cost_id: item.work_order_cost_id,
      line_no: item.line_no,
      product_code: item.product_code,
      part_name: item.part_name,
      old_unit_price: item.old_unit_price,
      new_unit_price: item.new_unit_price,
      cost_type: item.cost_type,
      master_type: item.master_type,
    }))

    return NextResponse.json({
      success: true,
      mode: 'execute',
      summary: {
        totalScanned: allItems.length,
        updated: toUpdate.length,
        skippedNoProduct,
        skippedNoCost,
        unchanged,
        affectedWorkOrders: affectedCostIds.length,
      },
      details,
      detailsTruncated: toUpdate.length > 500,
    })
  } catch (err) {
    console.error('bulk-apply-cost-all error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
