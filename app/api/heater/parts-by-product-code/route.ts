import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

const isSyntheticCostName = (name: string) => {
  const n = name.trim()
  return n === '工賃' || n === '材料費' || n === '間接費'
}

type ModelUsage = {
  model: string
  quantity: number
}

type ProductCodeRow = {
  product_code: string
  product_name: string
  spec: string
  part_keys: string[]
  total_quantity: number
  model_count: number
  models: ModelUsage[]
}

/**
 * GET /api/heater/parts-by-product-code
 *
 * L指令原価明細（work_order_cost_items）の商品コード単位で集約し、
 * BOM経由で使用機種・数量を返す。
 * ※ パーツマスタ単位ではなく、明細の product_code 単位。
 */
export async function GET() {
  try {
    // 1) BOM: part_key → 使用機種・数量
    let allBom: Array<{ model: string; part_key: string; quantity: number }> = []
    let from = 0
    const pageSize = 1000

    while (true) {
      const { data, error } = await supabase
        .from('heater_bom')
        .select('model, part_key, quantity')
        .range(from, from + pageSize - 1)

      if (error) {
        console.error('parts-by-product-code bom fetch error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (!data || data.length === 0) break

      allBom = allBom.concat(
        data.map((row) => ({
          model: String(row.model || '').trim(),
          part_key: String(row.part_key || '').trim(),
          quantity: toNumber(row.quantity) || 1,
        }))
      )
      if (data.length < pageSize) break
      from += pageSize
    }

    const bomByPart = new Map<string, Array<{ model: string; quantity: number }>>()
    for (const bom of allBom) {
      if (!bom.model || !bom.part_key) continue
      const list = bomByPart.get(bom.part_key) || []
      list.push({ model: bom.model, quantity: bom.quantity })
      bomByPart.set(bom.part_key, list)
    }

    // 2) L指令原価明細をページング取得
    let allItems: Array<{
      master_id: string
      product_code: string
      part_name: string
      spec: string
      quantity: number
    }> = []
    from = 0

    while (true) {
      const { data, error } = await supabase
        .from('work_order_cost_items')
        .select('master_id, product_code, part_name, spec, quantity')
        .eq('master_type', 'ライン原価')
        .range(from, from + pageSize - 1)

      if (error) {
        console.error('parts-by-product-code cost items fetch error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (!data || data.length === 0) break

      allItems = allItems.concat(
        data.map((row) => ({
          master_id: String(row.master_id || '').trim(),
          product_code: String(row.product_code || '').trim(),
          part_name: String(row.part_name || '').trim(),
          spec: String(row.spec || '').trim(),
          quantity: toNumber(row.quantity),
        }))
      )
      if (data.length < pageSize) break
      from += pageSize
    }

    // 3) part_key × product_code ごとの明細数量を集約
    type PartProduct = {
      quantity: number
      product_name: string
      spec: string
    }
    const qtyByPartAndCode = new Map<string, Map<string, PartProduct>>()

    for (const item of allItems) {
      if (!item.master_id) continue
      if (isSyntheticCostName(item.part_name)) continue

      const productCode = item.product_code || '（商品コード未設定）'
      // 商品コード未設定かつ名前も無い行はスキップ
      if (productCode === '（商品コード未設定）' && !item.part_name) continue

      let byCode = qtyByPartAndCode.get(item.master_id)
      if (!byCode) {
        byCode = new Map()
        qtyByPartAndCode.set(item.master_id, byCode)
      }

      const prev = byCode.get(productCode)
      if (!prev) {
        byCode.set(productCode, {
          quantity: item.quantity,
          product_name: item.part_name,
          spec: item.spec,
        })
      } else {
        prev.quantity += item.quantity
        if (!prev.product_name && item.part_name) prev.product_name = item.part_name
        if (!prev.spec && item.spec) prev.spec = item.spec
      }
    }

    // 4) 商品コード単位へ展開（BOM数量 × 明細数量）
    const agg = new Map<
      string,
      {
        product_code: string
        product_name: string
        spec: string
        partKeys: Set<string>
        modelQty: Map<string, number>
      }
    >()

    for (const [partKey, byCode] of qtyByPartAndCode.entries()) {
      const models = bomByPart.get(partKey)
      if (!models || models.length === 0) continue

      for (const [productCode, info] of byCode.entries()) {
        let row = agg.get(productCode)
        if (!row) {
          row = {
            product_code: productCode,
            product_name: info.product_name || productCode,
            spec: info.spec,
            partKeys: new Set<string>(),
            modelQty: new Map<string, number>(),
          }
          agg.set(productCode, row)
        }

        if (!row.product_name && info.product_name) row.product_name = info.product_name
        if (!row.spec && info.spec) row.spec = info.spec
        row.partKeys.add(partKey)

        for (const bom of models) {
          const addQty = info.quantity * bom.quantity
          row.modelQty.set(bom.model, (row.modelQty.get(bom.model) || 0) + addQty)
        }
      }
    }

    // 5) products マスタから商品名を補完
    const codes = Array.from(agg.keys()).filter((c) => c && c !== '（商品コード未設定）')
    if (codes.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('product_code, name')
        .in('product_code', codes)

      const nameByCode = new Map(
        (products || []).map((p) => [String(p.product_code || '').trim(), String(p.name || '').trim()])
      )
      for (const row of agg.values()) {
        const masterName = nameByCode.get(row.product_code)
        if (masterName) row.product_name = masterName
      }
    }

    const rows: ProductCodeRow[] = Array.from(agg.values())
      .map((row) => {
        const models = Array.from(row.modelQty.entries())
          .map(([model, quantity]) => ({
            model,
            quantity: Math.round(quantity * 1000) / 1000,
          }))
          .sort((a, b) => a.model.localeCompare(b.model, 'ja', { numeric: true }))

        const totalQuantity = models.reduce((s, m) => s + m.quantity, 0)

        return {
          product_code: row.product_code,
          product_name: row.product_name || row.product_code,
          spec: row.spec,
          part_keys: Array.from(row.partKeys).sort((a, b) => a.localeCompare(b, 'ja')),
          total_quantity: Math.round(totalQuantity * 1000) / 1000,
          model_count: models.length,
          models,
        }
      })
      .sort((a, b) => {
        if (a.product_code === '（商品コード未設定）') return 1
        if (b.product_code === '（商品コード未設定）') return -1
        return a.product_code.localeCompare(b.product_code, 'ja', { numeric: true })
      })

    return NextResponse.json({
      ok: true,
      count: rows.length,
      rows,
    })
  } catch (err) {
    console.error('parts-by-product-code unexpected error:', err)
    return NextResponse.json({ error: '集計に失敗しました' }, { status: 500 })
  }
}
