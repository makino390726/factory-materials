import type { SupabaseClient } from '@supabase/supabase-js'

export type BomCostItem = {
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
  master_id?: string
}

export type BomBranchResult = {
  id: string
  branch_no: string
  part_key: string
  part_name: string | null
  product_code: string | null
  bom_quantity: number
  unit_cost: number
  subtotal: number
  notes: string | null
  synced_at: string | null
  cost_items: BomCostItem[]
}

export type WorkOrderBomSummaryRow = {
  work_order_id: string
  order_no: string
  product_name: string | null
  material_total: number
  indirect_total: number
  labor_total: number
  grand_total: number
  branch_count: number
  has_saved_cost: boolean
  cost_saved_at: string | null
}

type WorkOrderForBom = {
  id: string
  order_no: string
  product_name?: string | null
}

type BranchRow = {
  id: string
  branch_no: string
  part_key: string
  part_name?: string | null
  product_code?: string | null
  bom_quantity?: number | null
  unit_cost?: number | null
  subtotal?: number | null
  notes?: string | null
  synced_at?: string | null
}

type CostHeaderRow = {
  id: string
  work_order_id: string | null
  total_material_cost: number | null
  total_labor_cost: number | null
  total_indirect_cost: number | null
  total_cost: number | null
  updated_at: string | null
  created_at: string | null
}

export type SavedWorkOrderCostResult = {
  branches: BomBranchResult[]
  material_total: number
  labor_total: number
  indirect_total: number
  grand_total: number
  has_saved_cost: boolean
  cost_saved_at: string | null
}

function formatBranchNo(branchNo: string): string {
  const stripped = branchNo.replace(/^[A-Za-z]+/, '').replace(/^0+/, '')
  if (!stripped) return branchNo
  return String(parseInt(stripped, 10)).padStart(2, '0')
}

function mapCostItem(item: any): BomCostItem {
  const material = Number(item.material_cost || 0)
  const labor = Number(item.labor_cost || 0)
  const indirect = Number(item.indirect_cost || 0)
  return {
    id: String(item.id || ''),
    product_code: item.product_code ?? '',
    part_name: item.part_name ?? '',
    spec: item.spec ?? '',
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    material_cost: material,
    labor_cost: labor,
    indirect_cost: indirect,
    line_total: Number(item.line_total || material + labor + indirect),
    cost_type: item.cost_type || '加',
    master_id: item.master_id ?? undefined,
  }
}

function buildBranchCandidateKeys(orderNo: string, branch: BranchRow): string[] {
  const partKey = String(branch.part_key || '').trim()
  const branchNo = String(branch.branch_no || '')
  const formattedNo = formatBranchNo(branchNo)
  const stripped = branchNo.replace(/^[A-Za-z]+/, '').replace(/^0+/, '') || branchNo

  const keys = [
    `${orderNo}-${formattedNo}`,
    `${orderNo}-${stripped}`,
    `${orderNo}-${branchNo}`,
    partKey,
  ].filter(Boolean)

  return [...new Set(keys)]
}

function sumItems(items: BomCostItem[]) {
  return items.reduce(
    (acc, item) => {
      acc.material += item.material_cost
      acc.labor += item.labor_cost
      acc.indirect += item.indirect_cost
      acc.total += item.line_total
      return acc
    },
    { material: 0, labor: 0, indirect: 0, total: 0 }
  )
}

/** 枝番明細は1セット分。枝番00のみ数量込み総額として扱う */
export function branchCostItemMultiplier(
  branch: Pick<BomBranchResult, 'branch_no' | 'bom_quantity'>
): number {
  if (String(branch.branch_no || '') === '00') return 1
  return Number(branch.bom_quantity || 1)
}

export function summarizeBomBranches(branches: BomBranchResult[]) {
  let material = 0
  let labor = 0
  let indirect = 0

  for (const branch of branches) {
    const qty = branchCostItemMultiplier(branch)
    for (const item of branch.cost_items || []) {
      material += item.material_cost * qty
      labor += item.labor_cost * qty
      indirect += item.indirect_cost * qty
    }
  }

  const materialTotal = Math.round(material)
  const laborTotal = Math.round(labor)
  const indirectTotal = Math.round(indirect)

  return {
    material_total: materialTotal,
    labor_total: laborTotal,
    indirect_total: indirectTotal,
    grand_total: materialTotal + laborTotal + indirectTotal,
  }
}

async function loadLatestCostHeader(
  supabase: SupabaseClient,
  workOrderId: string
): Promise<CostHeaderRow | null> {
  const { data, error } = await supabase
    .from('work_order_costs')
    .select(
      'id, work_order_id, total_material_cost, total_labor_cost, total_indirect_cost, total_cost, updated_at, created_at'
    )
    .eq('work_order_id', workOrderId)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return (data?.[0] as CostHeaderRow | undefined) ?? null
}

async function loadSavedOrderCostItems(
  supabase: SupabaseClient,
  headerId: string
): Promise<BomCostItem[]> {
  const { data, error } = await supabase
    .from('work_order_cost_items')
    .select(
      'id, master_id, master_type, product_code, part_name, spec, quantity, unit_price, material_cost, labor_cost, indirect_cost, line_total, cost_type'
    )
    .eq('work_order_cost_id', headerId)
    .eq('master_type', '指令原価')
    .order('line_no', { ascending: true })

  if (error) throw error
  return (data || []).map(mapCostItem)
}

function buildBranchesFromSavedItems(
  wo: WorkOrderForBom,
  branches: BranchRow[],
  items: BomCostItem[],
  header: CostHeaderRow
): BomBranchResult[] {
  const itemsByMasterId = new Map<string, BomCostItem[]>()
  for (const item of items) {
    const key = String(item.master_id || '').trim()
    if (!key) continue
    const list = itemsByMasterId.get(key) || []
    list.push(item)
    itemsByMasterId.set(key, list)
  }

  const usedMasterIds = new Set<string>()
  const branchResults: BomBranchResult[] = []

  for (const branch of branches) {
    const candidateKeys = buildBranchCandidateKeys(wo.order_no, branch)
    let matchedItems: BomCostItem[] = []
    let matchedKey = ''

    for (const key of candidateKeys) {
      const found = itemsByMasterId.get(key)
      if (found && found.length > 0) {
        matchedItems = found.map((item) => ({ ...item }))
        matchedKey = key
        break
      }
    }

    if (matchedKey) usedMasterIds.add(matchedKey)

    const itemSum = sumItems(matchedItems)
    const multiplier = branch.branch_no === '00' ? 1 : Number(branch.bom_quantity || 1)
    const subtotal = Math.round(itemSum.total * multiplier)

    branchResults.push({
      id: branch.id,
      branch_no: branch.branch_no,
      part_key: branch.part_key,
      part_name: branch.part_name ?? null,
      product_code: branch.product_code ?? null,
      bom_quantity: Number(branch.bom_quantity || 1),
      unit_cost: matchedItems.length > 0 ? Math.round(itemSum.total) : Number(branch.unit_cost || 0),
      subtotal,
      notes: branch.notes ?? null,
      synced_at: branch.synced_at ?? null,
      cost_items: matchedItems,
    })
  }

  const unassigned: BomCostItem[] = []
  for (const [masterId, masterItems] of itemsByMasterId) {
    if (!usedMasterIds.has(masterId)) {
      unassigned.push(...masterItems)
    }
  }

  if (unassigned.length > 0) {
    const wholeOrderItems =
      itemsByMasterId.get(wo.order_no)?.map((item) => ({ ...item })) ||
      unassigned.map((item) => ({ ...item }))
    const itemSum = sumItems(wholeOrderItems)
    const existingWhole = branchResults.find(
      (b) => b.part_key === wo.order_no || b.branch_no === '指令全体'
    )
    if (existingWhole) {
      existingWhole.cost_items = wholeOrderItems
      existingWhole.subtotal = Math.round(itemSum.total)
      existingWhole.unit_cost = Math.round(itemSum.total)
    } else {
      branchResults.unshift({
        id: `${wo.id}-saved-whole`,
        branch_no: '指令全体',
        part_key: wo.order_no,
        part_name: '指令原価（保存明細）',
        product_code: null,
        bom_quantity: 1,
        unit_cost: Math.round(itemSum.total),
        subtotal: Math.round(itemSum.total),
        notes: null,
        synced_at: header.updated_at ?? null,
        cost_items: wholeOrderItems,
      })
    }
  }

  const branchItemTotals = summarizeBomBranches(branchResults)
  const headerLabor = Number(header.total_labor_cost || 0)
  const headerIndirect = Number(header.total_indirect_cost || 0)
  const laborGap = Math.round(headerLabor - branchItemTotals.labor_total)
  const indirectGap = Math.round(headerIndirect - branchItemTotals.indirect_total)

  if (laborGap !== 0 || indirectGap !== 0) {
    const laborBranch =
      branchResults.find((b) => b.branch_no === '00') ||
      branchResults.find((b) => b.part_name?.includes('工賃'))

    if (laborBranch) {
      const extraItems = [...laborBranch.cost_items]
      if (laborGap > 0) {
        extraItems.push({
          id: `${wo.id}-header-labor`,
          product_code: '',
          part_name: '工賃（指令ヘッダ）',
          spec: '指令原価計算で保存された工賃',
          quantity: 1,
          unit_price: laborGap,
          material_cost: 0,
          labor_cost: laborGap,
          indirect_cost: 0,
          line_total: laborGap,
          cost_type: '加',
        })
      }
      if (indirectGap > 0) {
        extraItems.push({
          id: `${wo.id}-header-indirect`,
          product_code: '',
          part_name: '間接費（指令ヘッダ）',
          spec: '指令原価計算で保存された間接費',
          quantity: 1,
          unit_price: indirectGap,
          material_cost: 0,
          labor_cost: 0,
          indirect_cost: indirectGap,
          line_total: indirectGap,
          cost_type: '加',
        })
      }
      const sum = sumItems(extraItems)
      laborBranch.cost_items = extraItems
      laborBranch.subtotal = Math.round(sum.total * branchCostItemMultiplier(laborBranch))
      laborBranch.unit_cost = Math.round(sum.total)
    } else {
      branchResults.unshift({
        id: `${wo.id}-header-cost`,
        branch_no: '00',
        part_key: `${wo.order_no}-00`,
        part_name: '指令工賃・間接費',
        product_code: null,
        bom_quantity: 1,
        unit_cost: laborGap + indirectGap,
        subtotal: laborGap + indirectGap,
        notes: null,
        synced_at: header.updated_at ?? null,
        cost_items: [
          ...(laborGap > 0
            ? [
                {
                  id: `${wo.id}-header-labor`,
                  product_code: '',
                  part_name: '工賃（指令ヘッダ）',
                  spec: '',
                  quantity: 1,
                  unit_price: laborGap,
                  material_cost: 0,
                  labor_cost: laborGap,
                  indirect_cost: 0,
                  line_total: laborGap,
                  cost_type: '加',
                },
              ]
            : []),
          ...(indirectGap > 0
            ? [
                {
                  id: `${wo.id}-header-indirect`,
                  product_code: '',
                  part_name: '間接費（指令ヘッダ）',
                  spec: '',
                  quantity: 1,
                  unit_price: indirectGap,
                  material_cost: 0,
                  labor_cost: 0,
                  indirect_cost: indirectGap,
                  line_total: indirectGap,
                  cost_type: '加',
                },
              ]
            : []),
        ],
      })
    }
  }

  return branchResults
}

/** 指令原価計算の保存結果（work_order_costs）を正とした集計 */
export async function aggregateWorkOrderSavedCost(
  supabase: SupabaseClient,
  wo: WorkOrderForBom,
  branches: BranchRow[]
): Promise<SavedWorkOrderCostResult> {
  const header = await loadLatestCostHeader(supabase, wo.id)

  if (!header) {
    return {
      branches: [],
      material_total: 0,
      labor_total: 0,
      indirect_total: 0,
      grand_total: 0,
      has_saved_cost: false,
      cost_saved_at: null,
    }
  }

  const items = await loadSavedOrderCostItems(supabase, header.id)
  const branchResults =
    branches.length > 0
      ? buildBranchesFromSavedItems(wo, branches, items, header)
      : items.length > 0
        ? buildBranchesFromSavedItems(wo, [], items, header)
        : []

  if (branches.length === 0 && items.length > 0 && branchResults.length === 0) {
    const itemSum = sumItems(items)
    branchResults.push({
      id: `${wo.id}-saved-all`,
      branch_no: '指令全体',
      part_key: wo.order_no,
      part_name: '指令原価（保存明細）',
      product_code: null,
      bom_quantity: 1,
      unit_cost: Math.round(itemSum.total),
      subtotal: Math.round(itemSum.total),
      notes: null,
      synced_at: header.updated_at ?? null,
      cost_items: items,
    })
  }

  return {
    branches: branchResults,
    material_total: Number(header.total_material_cost || 0),
    labor_total: Number(header.total_labor_cost || 0),
    indirect_total: Number(header.total_indirect_cost || 0),
    grand_total: Number(header.total_cost || 0),
    has_saved_cost: true,
    cost_saved_at: header.updated_at || header.created_at || null,
  }
}

export async function listWorkOrderBomSummaries(
  supabase: SupabaseClient,
  filter: 'all' | 'bom' = 'bom'
): Promise<{
  rows: WorkOrderBomSummaryRow[]
  totals: Omit<WorkOrderBomSummaryRow, 'work_order_id' | 'order_no' | 'product_name' | 'branch_count' | 'has_saved_cost' | 'cost_saved_at'>
}> {
  const { data: workOrders, error: woErr } = await supabase
    .from('work_orders')
    .select('id, order_no, product_name, bom_model, cost_mode')
    .order('order_no', { ascending: true })

  if (woErr) throw woErr

  const filtered =
    filter === 'bom'
      ? (workOrders || []).filter(
          (wo) => wo.cost_mode === 'bom' || Boolean(String(wo.bom_model || '').trim())
        )
      : workOrders || []

  if (filtered.length === 0) {
    return {
      rows: [],
      totals: { material_total: 0, indirect_total: 0, labor_total: 0, grand_total: 0 },
    }
  }

  const workOrderIds = filtered.map((wo) => wo.id)

  const [{ data: headers, error: headerErr }, { data: branchRows, error: brErr }] =
    await Promise.all([
      supabase
        .from('work_order_costs')
        .select(
          'id, work_order_id, total_material_cost, total_labor_cost, total_indirect_cost, total_cost, updated_at, created_at'
        )
        .in('work_order_id', workOrderIds),
      supabase
        .from('work_order_branches')
        .select('work_order_id')
        .in('work_order_id', workOrderIds),
    ])

  if (headerErr) throw headerErr
  if (brErr) throw brErr

  const headerByWorkOrderId = new Map<string, CostHeaderRow>()
  for (const header of (headers || []) as CostHeaderRow[]) {
    const workOrderId = String(header.work_order_id || '')
    if (!workOrderId) continue
    const existing = headerByWorkOrderId.get(workOrderId)
    const headerTime = String(header.updated_at || header.created_at || '')
    const existingTime = String(existing?.updated_at || existing?.created_at || '')
    if (!existing || headerTime.localeCompare(existingTime) > 0) {
      headerByWorkOrderId.set(workOrderId, header)
    }
  }

  const branchCountByWorkOrderId = new Map<string, number>()
  for (const branch of branchRows || []) {
    const workOrderId = String(branch.work_order_id || '')
    branchCountByWorkOrderId.set(workOrderId, (branchCountByWorkOrderId.get(workOrderId) || 0) + 1)
  }

  const rows: WorkOrderBomSummaryRow[] = filtered.map((wo) => {
    const header = headerByWorkOrderId.get(wo.id)
    if (!header) {
      return {
        work_order_id: wo.id,
        order_no: wo.order_no,
        product_name: wo.product_name ?? null,
        material_total: 0,
        indirect_total: 0,
        labor_total: 0,
        grand_total: 0,
        branch_count: branchCountByWorkOrderId.get(wo.id) || 0,
        has_saved_cost: false,
        cost_saved_at: null,
      }
    }

    return {
      work_order_id: wo.id,
      order_no: wo.order_no,
      product_name: wo.product_name ?? null,
      material_total: Number(header.total_material_cost || 0),
      indirect_total: Number(header.total_indirect_cost || 0),
      labor_total: Number(header.total_labor_cost || 0),
      grand_total: Number(header.total_cost || 0),
      branch_count: branchCountByWorkOrderId.get(wo.id) || 0,
      has_saved_cost: true,
      cost_saved_at: header.updated_at || header.created_at || null,
    }
  })

  const totals = rows.reduce(
    (acc, row) => ({
      material_total: acc.material_total + row.material_total,
      indirect_total: acc.indirect_total + row.indirect_total,
      labor_total: acc.labor_total + row.labor_total,
      grand_total: acc.grand_total + row.grand_total,
    }),
    { material_total: 0, indirect_total: 0, labor_total: 0, grand_total: 0 }
  )

  return { rows, totals }
}
