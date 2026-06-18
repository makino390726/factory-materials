import type { SupabaseClient } from '@supabase/supabase-js'

export type PartCostUnit = {
  material_unit: number
  labor_unit: number
  indirect_unit: number
  total_unit: number
}

type CostItemRow = {
  master_id: string
  material_cost: number | null
  labor_cost: number | null
  indirect_cost: number | null
  line_total: number | null
  work_order_cost_id: string
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

type PartsMasterFallback = {
  cost_price: number | null
  material_cost_total: number | null
  indirect_cost_total: number | null
}

function emptyUnit(): PartCostUnit {
  return { material_unit: 0, labor_unit: 0, indirect_unit: 0, total_unit: 0 }
}

function buildUnitFromHeaderAndItems(
  header: CostHeaderRow,
  items: CostItemRow[]
): PartCostUnit {
  const itemLabor = items.reduce((sum, row) => sum + Number(row.labor_cost || 0), 0)
  const itemIndirect = items.reduce((sum, row) => sum + Number(row.indirect_cost || 0), 0)
  const itemMaterial = items.reduce((sum, row) => sum + Number(row.material_cost || 0), 0)

  const materialUnit = Number(header.total_material_cost ?? itemMaterial)
  const laborUnit = Number(header.total_labor_cost || 0) + itemLabor
  const indirectUnit = Number(header.total_indirect_cost || 0) + itemIndirect
  const totalUnit = Number(
    header.total_cost || materialUnit + laborUnit + indirectUnit
  )

  return { material_unit: materialUnit, labor_unit: laborUnit, indirect_unit: indirectUnit, total_unit: totalUnit }
}

function buildUnitFromItemsOnly(items: CostItemRow[]): PartCostUnit {
  const materialUnit = items.reduce((sum, row) => sum + Number(row.material_cost || 0), 0)
  const laborUnit = items.reduce((sum, row) => sum + Number(row.labor_cost || 0), 0)
  const indirectUnit = items.reduce((sum, row) => sum + Number(row.indirect_cost || 0), 0)
  const totalUnit = items.reduce((sum, row) => sum + Number(row.line_total || 0), 0)

  return {
    material_unit: materialUnit,
    labor_unit: laborUnit,
    indirect_unit: indirectUnit,
    total_unit: totalUnit || materialUnit + laborUnit + indirectUnit,
  }
}

function buildUnitFromPartsMaster(part: PartsMasterFallback): PartCostUnit {
  const costPrice = Number(part.cost_price || 0)
  const materialUnit = Number(part.material_cost_total || 0)
  const indirectUnit = Number(part.indirect_cost_total || 0)
  const laborUnit = Math.max(0, costPrice - materialUnit - indirectUnit)

  return {
    material_unit: materialUnit || (laborUnit === 0 && indirectUnit === 0 ? costPrice : 0),
    labor_unit: laborUnit,
    indirect_unit: indirectUnit,
    total_unit: costPrice,
  }
}

/** ライン原価から part_key ごとの1個あたり内訳（材料費・工賃・間接費）を構築 */
export async function buildLinePartCostUnitMap(
  supabase: SupabaseClient,
  partKeys: string[],
  partsMap?: Map<string, PartsMasterFallback>
): Promise<Map<string, PartCostUnit>> {
  const result = new Map<string, PartCostUnit>()
  const uniqueKeys = [...new Set(partKeys.map((key) => key.trim()).filter(Boolean))]
  if (uniqueKeys.length === 0) return result

  const { data: items, error: itemsError } = await supabase
    .from('work_order_cost_items')
    .select(
      'master_id, material_cost, labor_cost, indirect_cost, line_total, work_order_cost_id'
    )
    .eq('master_type', 'ライン原価')
    .in('master_id', uniqueKeys)

  if (itemsError) throw itemsError

  const itemsByPart = new Map<string, CostItemRow[]>()
  const headerIds = new Set<string>()

  for (const row of (items || []) as CostItemRow[]) {
    const key = String(row.master_id || '').trim()
    if (!key) continue
    const list = itemsByPart.get(key) || []
    list.push(row)
    itemsByPart.set(key, list)
    if (row.work_order_cost_id) headerIds.add(row.work_order_cost_id)
  }

  const headersById = new Map<string, CostHeaderRow>()
  if (headerIds.size > 0) {
    const { data: headers, error: headerError } = await supabase
      .from('work_order_costs')
      .select(
        'id, total_material_cost, total_labor_cost, total_indirect_cost, total_cost, updated_at, created_at'
      )
      .in('id', [...headerIds])

    if (headerError) throw headerError

    for (const header of (headers || []) as CostHeaderRow[]) {
      headersById.set(header.id, header)
    }
  }

  for (const partKey of uniqueKeys) {
    const partItems = itemsByPart.get(partKey) || []

    if (partItems.length > 0) {
      const headerCandidates = new Map<string, CostHeaderRow>()
      for (const item of partItems) {
        const header = headersById.get(item.work_order_cost_id)
        if (header) headerCandidates.set(header.id, header)
      }

      if (headerCandidates.size > 0) {
        const latestHeader = [...headerCandidates.values()].sort((a, b) => {
          const aTime = String(a.updated_at || a.created_at || '')
          const bTime = String(b.updated_at || b.created_at || '')
          return bTime.localeCompare(aTime)
        })[0]

        const latestItems = partItems.filter(
          (item) => item.work_order_cost_id === latestHeader.id
        )
        result.set(partKey, buildUnitFromHeaderAndItems(latestHeader, latestItems))
        continue
      }

      result.set(partKey, buildUnitFromItemsOnly(partItems))
      continue
    }

    const partInfo = partsMap?.get(partKey)
    if (partInfo && Number(partInfo.cost_price || 0) > 0) {
      result.set(partKey, buildUnitFromPartsMaster(partInfo))
      continue
    }

    result.set(partKey, emptyUnit())
  }

  return result
}
