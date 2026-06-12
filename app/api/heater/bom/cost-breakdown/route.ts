import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/heater/bom/cost-breakdown?model=DR8-008
 *
 * 指定モデルの BOM を展開し、各パーツの原価明細（work_order_cost_items）を
 * セクション単位で集計して返す。
 *
 * レスポンス構造:
 * {
 *   model: string,
 *   product_code: string | null,
 *   current_cost_price: number | null,  // products テーブルの現在値
 *   grand_total: number,                // BOM 全体の積み上げ合計
 *   sections: [
 *     {
 *       part_key: string,
 *       part_name: string | null,
 *       bom_quantity: number,           // BOM での使用数量
 *       unit_cost: number,              // parts_master.cost_price（1個当たり原価）
 *       subtotal: number,               // unit_cost × bom_quantity
 *       cost_items: [                   // 原価明細行（ライン原価）
 *         {
 *           id: string,
 *           product_code: string,
 *           part_name: string,
 *           spec: string,
 *           quantity: number,
 *           unit_price: number,
 *           material_cost: number,
 *           labor_cost: number,
 *           indirect_cost: number,
 *           line_total: number,
 *           cost_type: string,
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const model = url.searchParams.get('model')

    if (!model) {
      return NextResponse.json({ error: 'model パラメータが必要です' }, { status: 400 })
    }

    // 1) BOM 取得（model に紐づく全パーツ）
    const { data: bomRows, error: bomError } = await supabase
      .from('heater_bom')
      .select('part_key, part_name, quantity')
      .eq('model', model)
      .order('part_key')

    if (bomError) {
      console.error('BOM fetch error:', bomError)
      return NextResponse.json({ error: bomError.message }, { status: 500 })
    }

    const partKeys = (bomRows || []).map((b: any) => b.part_key as string)

    // 2) パーツマスタ取得（原価・品番）
    let partsMap: Record<string, { part_name: string | null; product_code: string | null; cost_price: number }> = {}
    if (partKeys.length > 0) {
      const { data: partsData, error: partsError } = await supabase
        .from('heater_parts_master')
        .select('part_key, part_name, product_code, cost_price')
        .in('part_key', partKeys)

      if (partsError) {
        console.error('parts master fetch error:', partsError)
        return NextResponse.json({ error: partsError.message }, { status: 500 })
      }

      for (const p of partsData || []) {
        partsMap[p.part_key] = {
          part_name: p.part_name ?? null,
          product_code: p.product_code ?? null,
          cost_price: Number(p.cost_price || 0),
        }
      }
    }

    // 3) 原価明細取得（各パーツの work_order_cost_items）
    let costItemsMap: Record<string, any[]> = {}
    if (partKeys.length > 0) {
      const { data: costItems, error: costItemsError } = await supabase
        .from('work_order_cost_items')
        .select(
          'id, master_id, product_code, part_name, spec, quantity, unit_price, material_cost, labor_cost, indirect_cost, line_total, cost_type'
        )
        .eq('master_type', 'ライン原価')
        .in('master_id', partKeys)
        .order('line_no', { ascending: true })

      if (costItemsError) {
        console.error('cost items fetch error:', costItemsError)
        return NextResponse.json({ error: costItemsError.message }, { status: 500 })
      }

      for (const item of costItems || []) {
        const key = item.master_id as string
        if (!costItemsMap[key]) costItemsMap[key] = []
        costItemsMap[key].push({
          id: item.id,
          product_code: item.product_code ?? '',
          part_name: item.part_name ?? '',
          spec: item.spec ?? '',
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
          material_cost: Number(item.material_cost || 0),
          labor_cost: Number(item.labor_cost || 0),
          indirect_cost: Number(item.indirect_cost || 0),
          line_total: Number(item.line_total || 0),
          cost_type: item.cost_type || '加',
        })
      }
    }

    // 4) モデルの product_code を取得して現在の製品原価を確認
    let modelProductCode: string | null = null
    let currentCostPrice: number | null = null

    const { data: modelRow } = await supabase
      .from('heater_models')
      .select('product_code')
      .eq('model', model)
      .maybeSingle()

    if (modelRow?.product_code) {
      modelProductCode = modelRow.product_code
      const { data: productRow } = await supabase
        .from('products')
        .select('cost_price')
        .eq('product_code', modelRow.product_code)
        .maybeSingle()
      currentCostPrice = productRow ? Number(productRow.cost_price ?? null) : null
    }

    // 5) セクション（パーツ単位）に集計
    let grandTotal = 0
    const sections = (bomRows || []).map((bom: any) => {
      const partKey = bom.part_key as string
      const bomQty = Number(bom.quantity || 1)
      const partInfo = partsMap[partKey] ?? { part_name: null, product_code: null, cost_price: 0 }
      const items = costItemsMap[partKey] ?? []

      // unit_cost = parts_master.cost_price（ライン原価集計済み値）
      // cost_items が存在する場合は items の sum でも確認可能だが、parts_master を正値とする
      const unitCost = partInfo.cost_price
      const subtotal = Math.round(unitCost * bomQty)
      grandTotal += subtotal

      return {
        part_key: partKey,
        part_name: bom.part_name ?? partInfo.part_name ?? null,
        product_code: partInfo.product_code,
        bom_quantity: bomQty,
        unit_cost: unitCost,
        subtotal,
        cost_items: items,
      }
    })

    return NextResponse.json({
      model,
      product_code: modelProductCode,
      current_cost_price: currentCostPrice,
      grand_total: grandTotal,
      sections,
    })
  } catch (err) {
    console.error('cost-breakdown error:', err)
    return NextResponse.json({ error: '集計に失敗しました' }, { status: 500 })
  }
}
