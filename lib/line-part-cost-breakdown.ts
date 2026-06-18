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

export type MasterCostKey = {
  master_id: string
  master_type: string
}

export function masterCostMapKey(master_id: string, master_type: string): string {
  return `${master_type}:${master_id}`
}

type DisplayCostItem = {
  id: string
  product_code: string
  part_name: string
  spec: string
  quantity: number
  unit_price: number
  material_cost: number
  labor_cost: number
  indirect_cost: number
  line_total: number
  cost_type: string
}

/** 明細行とヘッダ内訳を突き合わせ、工賃・間接費の欠落を補完する */
export function reconcileCostItemsWithBreakdown(
  items: DisplayCostItem[],
  unit: PartCostUnit,
  idPrefix: string
): DisplayCostItem[] {
  const result = items.map((item) => ({ ...item }))
  const itemLabor = result.reduce((sum, row) => sum + Number(row.labor_cost || 0), 0)
  const itemMaterial = result.reduce((sum, row) => sum + Number(row.material_cost || 0), 0)
  const itemIndirect = result.reduce((sum, row) => sum + Number(row.indirect_cost || 0), 0)

  const laborGap = Math.round(unit.labor_unit - itemLabor)
  const materialGap = Math.round(unit.material_unit - itemMaterial)
  const indirectGap = Math.round(unit.indirect_unit - itemIndirect)

  const applyGap = (
    gap: number,
    field: 'material_cost' | 'labor_cost' | 'indirect_cost',
    label: string
  ) => {
    if (gap <= 0) return
    const rowIndex = result.findIndex(
      (row) =>
        row.part_name === label ||
        (field === 'labor_cost' && row.part_name.includes('工賃'))
    )
    if (rowIndex >= 0) {
      const row = { ...result[rowIndex] }
      row[field] = Number(row[field] || 0) + gap
      row.line_total = row.material_cost + row.labor_cost + row.indirect_cost
      result[rowIndex] = row
      return
    }
    result.push({
      id: `${idPrefix}-${field}`,
      product_code: '',
      part_name: label,
      spec: '',
      quantity: field === 'labor_cost' ? 1 : 0,
      unit_price: 0,
      material_cost: field === 'material_cost' ? gap : 0,
      labor_cost: field === 'labor_cost' ? gap : 0,
      indirect_cost: field === 'indirect_cost' ? gap : 0,
      line_total: gap,
      cost_type: '加',
    })
  }

  applyGap(materialGap, 'material_cost', '材料費')
  applyGap(laborGap, 'labor_cost', '工賃')
  applyGap(indirectGap, 'indirect_cost', '間接費')

  return result
}

/** 原価明細が無い場合に内訳から表示用1行ずつ生成 */
export function buildDisplayItemsFromUnit(unit: PartCostUnit, idPrefix: string): DisplayCostItem[] {
  const items: DisplayCostItem[] = []
  if (unit.material_unit > 0) {
    items.push({
      id: `${idPrefix}-material`,
      product_code: '',
      part_name: '材料費',
      spec: '',
      quantity: 1,
      unit_price: unit.material_unit,
      material_cost: unit.material_unit,
      labor_cost: 0,
      indirect_cost: 0,
      line_total: unit.material_unit,
      cost_type: '加',
    })
  }
  if (unit.labor_unit > 0) {
    items.push({
      id: `${idPrefix}-labor`,
      product_code: '',
      part_name: '工賃',
      spec: '',
      quantity: 1,
      unit_price: unit.labor_unit,
      material_cost: 0,
      labor_cost: unit.labor_unit,
      indirect_cost: 0,
      line_total: unit.labor_unit,
      cost_type: '加',
    })
  }
  if (unit.indirect_unit > 0) {
    items.push({
      id: `${idPrefix}-indirect`,
      product_code: '',
      part_name: '間接費',
      spec: '',
      quantity: 1,
      unit_price: unit.indirect_unit,
      material_cost: 0,
      labor_cost: 0,
      indirect_cost: unit.indirect_unit,
      line_total: unit.indirect_unit,
      cost_type: '加',
    })
  }
  return items
}

/** master_id + master_type ごとの1個あたり内訳を構築 */
export async function buildMasterCostUnitMap(
  supabase: SupabaseClient,
  specs: MasterCostKey[]
): Promise<Map<string, PartCostUnit>> {
  const result = new Map<string, PartCostUnit>()
  const uniqueSpecs = new Map<string, MasterCostKey>()
  for (const spec of specs) {
    const masterId = String(spec.master_id || '').trim()
    const masterType = String(spec.master_type || '').trim()
    if (!masterId || !masterType) continue
    uniqueSpecs.set(masterCostMapKey(masterId, masterType), { master_id: masterId, master_type: masterType })
  }
  if (uniqueSpecs.size === 0) return result

  const masterIds = [...new Set([...uniqueSpecs.values()].map((spec) => spec.master_id))]
  const { data: items, error: itemsError } = await supabase
    .from('work_order_cost_items')
    .select(
      'master_id, master_type, material_cost, labor_cost, indirect_cost, line_total, work_order_cost_id'
    )
    .in('master_id', masterIds)
    .in('master_type', ['指令原価', 'ライン原価'])

  if (itemsError) throw itemsError

  type ExtendedCostItemRow = CostItemRow & { master_type: string }
  const itemsByMaster = new Map<string, ExtendedCostItemRow[]>()
  const headerIds = new Set<string>()

  for (const row of (items || []) as ExtendedCostItemRow[]) {
    const key = masterCostMapKey(String(row.master_id || ''), String(row.master_type || ''))
    if (!uniqueSpecs.has(key)) continue
    const list = itemsByMaster.get(key) || []
    list.push(row)
    itemsByMaster.set(key, list)
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

  for (const [key, spec] of uniqueSpecs) {
    const masterItems = itemsByMaster.get(key) || []
    if (masterItems.length === 0) {
      result.set(key, emptyUnit())
      continue
    }

    const headerCandidates = new Map<string, CostHeaderRow>()
    for (const item of masterItems) {
      const header = headersById.get(item.work_order_cost_id)
      if (header) headerCandidates.set(header.id, header)
    }

    if (headerCandidates.size > 0) {
      const latestHeader = [...headerCandidates.values()].sort((a, b) => {
        const aTime = String(a.updated_at || a.created_at || '')
        const bTime = String(b.updated_at || b.created_at || '')
        return bTime.localeCompare(aTime)
      })[0]
      const latestItems = masterItems.filter(
        (item) => item.work_order_cost_id === latestHeader.id
      )
      result.set(key, buildUnitFromHeaderAndItems(latestHeader, latestItems))
      continue
    }

    result.set(key, buildUnitFromItemsOnly(masterItems))
  }

  return result
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
