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
 * BOM を商品コード単位で集約し、数量合計と使用機種一覧を返す。
 */
export async function GET() {
  try {
    let allBom: Array<{ model: string; part_key: string; part_name: string | null; quantity: number }> = []
    let from = 0
    const pageSize = 1000

    while (true) {
      const { data, error } = await supabase
        .from('heater_bom')
        .select('model, part_key, part_name, quantity')
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
          part_name: row.part_name != null ? String(row.part_name) : null,
          quantity: toNumber(row.quantity) || 1,
        }))
      )
      if (data.length < pageSize) break
      from += pageSize
    }

    const partKeys = [...new Set(allBom.map((b) => b.part_key).filter(Boolean))]
    const partsMap = new Map<
      string,
      { product_code: string; part_name: string; spec: string }
    >()

    if (partKeys.length > 0) {
      const { data: partsData, error: partsError } = await supabase
        .from('heater_parts_master')
        .select('part_key, product_code, part_name, spec')
        .in('part_key', partKeys)

      if (partsError) {
        console.error('parts-by-product-code parts fetch error:', partsError)
        return NextResponse.json({ error: partsError.message }, { status: 500 })
      }

      for (const p of partsData || []) {
        partsMap.set(String(p.part_key), {
          product_code: String(p.product_code || '').trim(),
          part_name: String(p.part_name || '').trim(),
          spec: String(p.spec || '').trim(),
        })
      }
    }

    // product_code -> aggregation
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

    for (const bom of allBom) {
      if (!bom.model || !bom.part_key) continue
      const part = partsMap.get(bom.part_key)
      const productCode = part?.product_code || '（未設定）'
      const productName = part?.part_name || bom.part_name || bom.part_key
      const spec = part?.spec || ''

      let row = agg.get(productCode)
      if (!row) {
        row = {
          product_code: productCode,
          product_name: productName,
          spec,
          partKeys: new Set<string>(),
          modelQty: new Map<string, number>(),
        }
        agg.set(productCode, row)
      }

      if (!row.product_name && productName) row.product_name = productName
      if (!row.spec && spec) row.spec = spec
      row.partKeys.add(bom.part_key)
      row.modelQty.set(bom.model, (row.modelQty.get(bom.model) || 0) + bom.quantity)
    }

    const rows: ProductCodeRow[] = Array.from(agg.values())
      .map((row) => {
        const models = Array.from(row.modelQty.entries())
          .map(([model, quantity]) => ({ model, quantity: Math.round(quantity * 1000) / 1000 }))
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
        if (a.product_code === '（未設定）') return 1
        if (b.product_code === '（未設定）') return -1
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
