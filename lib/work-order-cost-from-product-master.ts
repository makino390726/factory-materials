import type { SupabaseClient } from '@supabase/supabase-js'

const PAGE_SIZE = 1000
const UPDATE_CHUNK = 10
const IN_CHUNK = 200

/** cost_type「加」: (材料+労務)×30%、それ以外: ×5%（bulk-apply-cost-all と同一） */
export function indirectMultiplier(costType: string | null | undefined): number {
  return (costType || '加') === '加' ? 0.3 : 0.05
}

export function computeCostLineFromMasterUnitPrice(params: {
  productCost: number
  quantity: number | null
  labor_cost: number | null
  cost_type: string | null
}): {
  unit_price: number
  material_cost: number
  indirect_cost: number
  line_total: number
} {
  const qty = Number(params.quantity || 0)
  const labor = Number(params.labor_cost || 0)
  const mult = indirectMultiplier(params.cost_type)
  const material_cost = Math.round(qty * params.productCost)
  const indirect_cost = Math.round((material_cost + labor) * mult)
  const line_total = material_cost + labor + indirect_cost
  return {
    unit_price: params.productCost,
    material_cost,
    indirect_cost,
    line_total,
  }
}

export async function rollupWorkOrderCostHeaders(
  supabase: SupabaseClient,
  workOrderCostIds: string[]
): Promise<void> {
  const unique = Array.from(new Set(workOrderCostIds.filter(Boolean)))
  for (let i = 0; i < unique.length; i += UPDATE_CHUNK) {
    const chunk = unique.slice(i, i + UPDATE_CHUNK)
    await Promise.all(
      chunk.map(async (costId) => {
        const { data: itemsForCost } = await supabase
          .from('work_order_cost_items')
          .select('material_cost, labor_cost, indirect_cost, line_total')
          .eq('work_order_cost_id', costId)

        if (!itemsForCost) return

        const totalMaterial = itemsForCost.reduce((s, r) => s + Number(r.material_cost || 0), 0)
        const totalLabor = itemsForCost.reduce((s, r) => s + Number(r.labor_cost || 0), 0)
        const totalIndirect = itemsForCost.reduce((s, r) => s + Number(r.indirect_cost || 0), 0)
        const totalCost = itemsForCost.reduce((s, r) => s + Number(r.line_total || 0), 0)

        await supabase
          .from('work_order_costs')
          .update({
            total_material_cost: totalMaterial,
            total_labor_cost: totalLabor,
            total_indirect_cost: totalIndirect,
            total_cost: totalCost,
          })
          .eq('id', costId)
      })
    )
  }
}

export type SyncWorkOrderCostItemsSummary = {
  updated: number
  skippedNoProduct: number
  skippedNoCost: number
  unchanged: number
  affectedWorkOrderCostIds: string[]
}

type CostItemRow = {
  id: string
  work_order_cost_id: string
  product_code: string | null
  quantity: number | null
  unit_price: number | null
  labor_cost: number | null
  cost_type: string | null
}

/**
 * 指定した商品コードの製品マスタ原価を、紐づく work_order_cost_items に反映し、
 * 材料費・間接費・行合計および work_order_costs ヘッダを再計算する。
 * （一括反映APIと同じ計算式）
 */
export async function syncWorkOrderCostItemsForProductCodes(
  supabase: SupabaseClient,
  productCodes: string[]
): Promise<SyncWorkOrderCostItemsSummary> {
  const codes = Array.from(
    new Set(productCodes.map((c) => String(c || '').trim()).filter((c) => c.length > 0))
  )
  if (codes.length === 0) {
    return {
      updated: 0,
      skippedNoProduct: 0,
      skippedNoCost: 0,
      unchanged: 0,
      affectedWorkOrderCostIds: [],
    }
  }

  const productCostMap = new Map<string, number | null>()
  const productCodeSet = new Set<string>()

  for (let i = 0; i < codes.length; i += IN_CHUNK) {
    const slice = codes.slice(i, i + IN_CHUNK)
    const { data: prows, error } = await supabase
      .from('products')
      .select('product_code, cost_price')
      .in('product_code', slice)

    if (error) {
      throw new Error(error.message)
    }

    for (const p of prows || []) {
      const code = String(p.product_code || '').trim()
      if (!code) continue
      productCodeSet.add(code)
      productCostMap.set(code, p.cost_price != null ? Number(p.cost_price) : null)
    }
  }

  const allItems: CostItemRow[] = []
  for (let j = 0; j < codes.length; j += IN_CHUNK) {
    const codeSlice = codes.slice(j, j + IN_CHUNK)
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: batch, error: itemsError } = await supabase
        .from('work_order_cost_items')
        .select(
          'id, work_order_cost_id, product_code, quantity, unit_price, labor_cost, cost_type'
        )
        .in('product_code', codeSlice)
        .not('product_code', 'is', null)
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      if (itemsError) {
        throw new Error(itemsError.message)
      }

      const rows = (batch || []) as CostItemRow[]
      allItems.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
  }

  let skippedNoProduct = 0
  let skippedNoCost = 0
  let unchanged = 0

  const toUpdate: Array<
    CostItemRow & {
      new_unit_price: number
      new_material_cost: number
      new_indirect_cost: number
      new_line_total: number
    }
  > = []

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

    const computed = computeCostLineFromMasterUnitPrice({
      productCost,
      quantity: item.quantity,
      labor_cost: item.labor_cost,
      cost_type: item.cost_type,
    })

    toUpdate.push({
      ...item,
      new_unit_price: computed.unit_price,
      new_material_cost: computed.material_cost,
      new_indirect_cost: computed.indirect_cost,
      new_line_total: computed.line_total,
    })
  }

  for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
    const chunk = toUpdate.slice(i, i + UPDATE_CHUNK)
    await Promise.all(
      chunk.map((u) =>
        supabase
          .from('work_order_cost_items')
          .update({
            unit_price: u.new_unit_price,
            material_cost: u.new_material_cost,
            indirect_cost: u.new_indirect_cost,
            line_total: u.new_line_total,
          })
          .eq('id', u.id)
      )
    )
  }

  const affectedWorkOrderCostIds = Array.from(new Set(toUpdate.map((x) => x.work_order_cost_id)))
  if (affectedWorkOrderCostIds.length > 0) {
    await rollupWorkOrderCostHeaders(supabase, affectedWorkOrderCostIds)
  }

  return {
    updated: toUpdate.length,
    skippedNoProduct,
    skippedNoCost,
    unchanged,
    affectedWorkOrderCostIds,
  }
}
