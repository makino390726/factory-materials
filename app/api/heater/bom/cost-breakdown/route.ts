import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildLinePartCostUnitMap } from '@/lib/line-part-cost-breakdown'

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
 *       unit_cost: number,              // 1個当たり原価
 *       material_cost: number,          // 材料費合計（単価内訳 × 数量）
 *       labor_cost: number,             // 工賃合計
 *       indirect_cost: number,          // 間接費合計
 *       subtotal: number,               // 合計（= total）
 *       cost_items: [...]
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
    let partsMap: Record<
      string,
      {
        part_name: string | null
        product_code: string | null
        cost_price: number
        material_cost_total: number | null
        indirect_cost_total: number | null
      }
    > = {}
    const partsFallbackMap = new Map<
      string,
      { cost_price: number | null; material_cost_total: number | null; indirect_cost_total: number | null }
    >()
    if (partKeys.length > 0) {
      const { data: partsData, error: partsError } = await supabase
        .from('heater_parts_master')
        .select('part_key, part_name, product_code, cost_price, material_cost_total, indirect_cost_total')
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
          material_cost_total: p.material_cost_total ?? null,
          indirect_cost_total: p.indirect_cost_total ?? null,
        }
        partsFallbackMap.set(p.part_key, {
          cost_price: p.cost_price ?? null,
          material_cost_total: p.material_cost_total ?? null,
          indirect_cost_total: p.indirect_cost_total ?? null,
        })
      }
    }

    // 3) 原価内訳（L指令原価）と明細行
    const lineCostMap = await buildLinePartCostUnitMap(supabase, partKeys, partsFallbackMap)

    let costItemsMap: Record<string, any[]> = {}
    if (partKeys.length > 0) {
      const { data: costItems, error: costItemsError } = await supabase
        .from('work_order_cost_items')
        .select(
          'id, master_id, component_name, product_code, part_name, spec, quantity, unit_price, material_cost, labor_cost, indirect_cost, line_total, cost_type'
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
          component_name: item.component_name ?? '',
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
      const partInfo = partsMap[partKey] ?? {
        part_name: null,
        product_code: null,
        cost_price: 0,
        material_cost_total: null,
        indirect_cost_total: null,
      }
      const items = costItemsMap[partKey] ?? []
      const lineCost = lineCostMap.get(partKey)

      const materialUnit = lineCost ? Number(lineCost.material_unit || 0) : Number(partInfo.material_cost_total || 0)
      const laborUnit = lineCost ? Number(lineCost.labor_unit || 0) : 0
      const indirectUnit = lineCost ? Number(lineCost.indirect_unit || 0) : Number(partInfo.indirect_cost_total || 0)
      const totalUnit = lineCost
        ? Number(lineCost.total_unit || materialUnit + laborUnit + indirectUnit)
        : Number(partInfo.cost_price || 0)

      const unitCost = totalUnit || Number(partInfo.cost_price || 0)
      const materialCost = Math.round(materialUnit * bomQty)
      const laborCost = Math.round(laborUnit * bomQty)
      const indirectCost = Math.round(indirectUnit * bomQty)
      const subtotal = Math.round(unitCost * bomQty)
      grandTotal += subtotal

      return {
        part_key: partKey,
        part_name: bom.part_name ?? partInfo.part_name ?? null,
        product_code: partInfo.product_code,
        bom_quantity: bomQty,
        unit_cost: unitCost,
        material_cost: materialCost,
        labor_cost: laborCost,
        indirect_cost: indirectCost,
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
