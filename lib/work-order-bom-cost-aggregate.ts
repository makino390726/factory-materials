import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildDisplayItemsFromUnit,
  buildLinePartCostUnitMap,
  buildMasterCostUnitMap,
  masterCostMapKey,
  reconcileCostItemsWithBreakdown,
  type PartCostUnit,
} from '@/lib/line-part-cost-breakdown'

const LABOR_UNIT_PRICE = 17810
const INDIRECT_RATE = 0.3

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
}

type WorkOrderForBom = {
  id: string
  order_no: string
  product_name?: string | null
  standard_duration_minutes?: number | null
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

export type BomCostPrefetch = {
  masterCostMap: Map<string, PartCostUnit>
  linePartCostMap: Map<string, PartCostUnit>
  orderCostItemsMap: Record<string, BomCostItem[]>
  lineCostItemsMap: Record<string, BomCostItem[]>
}

function formatBranchNo(branchNo: string): string {
  const stripped = branchNo.replace(/^[A-Za-z]+/, '').replace(/^0+/, '')
  if (!stripped) return branchNo
  return String(parseInt(stripped, 10)).padStart(2, '0')
}

function mapCostItem(item: any): BomCostItem {
  return {
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
  }
}

export function summarizeBomBranches(branches: BomBranchResult[]) {
  let material = 0
  let labor = 0
  let indirect = 0

  for (const branch of branches) {
    const qty = Number(branch.bom_quantity || 1)
    for (const item of branch.cost_items || []) {
      material += Number(item.material_cost || 0) * qty
      labor += Number(item.labor_cost || 0) * qty
      indirect += Number(item.indirect_cost || 0) * qty
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

export async function prefetchBomCostData(
  supabase: SupabaseClient,
  workOrders: WorkOrderForBom[],
  branchesByWorkOrderId: Map<string, BranchRow[]>
): Promise<BomCostPrefetch> {
  const allCandidateKeys = new Set<string>()
  const partKeysForLine = new Set<string>()

  for (const wo of workOrders) {
    const branches = branchesByWorkOrderId.get(wo.id) || []
    for (const branch of branches) {
      const partKey = String(branch.part_key || '').trim()
      const formattedNo = formatBranchNo(String(branch.branch_no || ''))
      allCandidateKeys.add(`${wo.order_no}-${formattedNo}`)
      if (partKey) {
        allCandidateKeys.add(partKey)
        if (!partKey.endsWith('-00')) partKeysForLine.add(partKey)
      }
    }
  }

  const masterSpecs = [...allCandidateKeys].flatMap((masterId) => [
    { master_id: masterId, master_type: '指令原価' },
    { master_id: masterId, master_type: 'ライン原価' },
  ])

  const [masterCostMap, linePartCostMap] = await Promise.all([
    buildMasterCostUnitMap(supabase, masterSpecs),
    buildLinePartCostUnitMap(supabase, [...partKeysForLine]),
  ])

  const orderCostItemsMap: Record<string, BomCostItem[]> = {}
  const lineCostItemsMap: Record<string, BomCostItem[]> = {}

  if (allCandidateKeys.size > 0) {
    const { data: costItems, error: ciErr } = await supabase
      .from('work_order_cost_items')
      .select(
        'id, master_id, master_type, product_code, part_name, spec, quantity, unit_price, material_cost, labor_cost, indirect_cost, line_total, cost_type'
      )
      .in('master_type', ['指令原価', 'ライン原価'])
      .in('master_id', [...allCandidateKeys])
      .order('line_no', { ascending: true })

    if (ciErr) throw ciErr

    for (const item of costItems || []) {
      const key = String(item.master_id || '')
      const mappedItem = mapCostItem(item)
      if (item.master_type === '指令原価') {
        if (!orderCostItemsMap[key]) orderCostItemsMap[key] = []
        orderCostItemsMap[key].push(mappedItem)
      } else {
        if (!lineCostItemsMap[key]) lineCostItemsMap[key] = []
        lineCostItemsMap[key].push(mappedItem)
      }
    }
  }

  return { masterCostMap, linePartCostMap, orderCostItemsMap, lineCostItemsMap }
}

function resolveUnitBreakdown(
  candidateKeys: string[],
  partKey: string,
  prefetch: BomCostPrefetch
): PartCostUnit {
  const { masterCostMap, linePartCostMap, orderCostItemsMap, lineCostItemsMap } = prefetch
  const empty: PartCostUnit = { material_unit: 0, labor_unit: 0, indirect_unit: 0, total_unit: 0 }

  for (const candidateKey of candidateKeys) {
    if ((orderCostItemsMap[candidateKey] || []).length > 0) {
      return masterCostMap.get(masterCostMapKey(candidateKey, '指令原価')) || empty
    }
    if ((lineCostItemsMap[candidateKey] || []).length > 0) {
      return (
        masterCostMap.get(masterCostMapKey(candidateKey, 'ライン原価')) ||
        linePartCostMap.get(candidateKey) ||
        empty
      )
    }
  }

  const lineUnit = partKey ? linePartCostMap.get(partKey) : undefined
  if (lineUnit && lineUnit.total_unit > 0) return lineUnit
  return empty
}

export function aggregateWorkOrderBomCost(
  wo: WorkOrderForBom,
  branches: BranchRow[],
  prefetch: BomCostPrefetch
): { branches: BomBranchResult[]; grand_total: number } & ReturnType<typeof summarizeBomBranches> {
  const branchCandidateKeys = branches.map((branch) => {
    const partKey = String(branch.part_key || '')
    const formattedNo = formatBranchNo(String(branch.branch_no || ''))
    const keys = [`${wo.order_no}-${formattedNo}`]
    if (partKey) keys.push(partKey)
    return keys
  })

  const { orderCostItemsMap, lineCostItemsMap } = prefetch

  const branchesWithItems: BomBranchResult[] = branches.map((branch, index) => {
    if (branch.branch_no === '00') {
      const qty = Number(branch.bom_quantity || 0)
      const unitPrice = Number(branch.unit_cost || LABOR_UNIT_PRICE)
      const laborAmt = Math.round(qty * unitPrice)
      const indirectAmt = Math.round(laborAmt * INDIRECT_RATE)
      const lineTotal = laborAmt + indirectAmt
      return {
        id: branch.id,
        branch_no: branch.branch_no,
        part_key: branch.part_key,
        part_name: branch.part_name ?? '工賃',
        product_code: null,
        bom_quantity: qty,
        unit_cost: unitPrice,
        subtotal: lineTotal,
        notes: branch.notes ?? null,
        synced_at: branch.synced_at ?? null,
        cost_items: [
          {
            id: `${branch.id}-labor`,
            product_code: '',
            part_name: '工賃',
            spec: '',
            quantity: qty,
            unit_price: unitPrice,
            material_cost: 0,
            labor_cost: laborAmt,
            indirect_cost: indirectAmt,
            line_total: lineTotal,
            cost_type: '加',
          },
        ],
      }
    }

    let items: BomCostItem[] = []
    for (const candidateKey of branchCandidateKeys[index]) {
      const found = orderCostItemsMap[candidateKey] ?? lineCostItemsMap[candidateKey]
      if (found && found.length > 0) {
        items = found.map((item) => ({ ...item }))
        break
      }
    }

    const unitBreakdown = resolveUnitBreakdown(
      branchCandidateKeys[index],
      String(branch.part_key || ''),
      prefetch
    )

    if (items.length > 0) {
      items = reconcileCostItemsWithBreakdown(
        items,
        unitBreakdown,
        `${branch.branch_no || branch.id}-reconcile`
      )
    } else if (unitBreakdown.total_unit > 0) {
      items = buildDisplayItemsFromUnit(unitBreakdown, `${branch.branch_no || branch.id}-unit`)
    }

    const unitCostFromBreakdown =
      unitBreakdown.total_unit > 0
        ? unitBreakdown.total_unit
        : items.length > 0
          ? items.reduce((sum, item) => sum + item.line_total, 0)
          : Number(branch.unit_cost || 0)

    return {
      id: branch.id,
      branch_no: branch.branch_no,
      part_key: branch.part_key,
      part_name: branch.part_name ?? null,
      product_code: branch.product_code ?? null,
      bom_quantity: Number(branch.bom_quantity || 1),
      unit_cost: unitCostFromBreakdown,
      subtotal: Math.round(unitCostFromBreakdown * Number(branch.bom_quantity || 1)),
      notes: branch.notes ?? null,
      synced_at: branch.synced_at ?? null,
      cost_items: items,
    }
  })

  let finalBranches = branchesWithItems
  const hasBranch00 = branchesWithItems.some((branch) => branch.branch_no === '00')

  if (!hasBranch00) {
    const stdMinutes = Number(wo.standard_duration_minutes || 0)
    const laborQty = stdMinutes > 0 ? Math.round((stdMinutes / 480) * 1000) / 1000 : 0
    const laborAmt = Math.round(laborQty * LABOR_UNIT_PRICE)
    const indirectAmt = Math.round(laborAmt * INDIRECT_RATE)
    const lineTotal = laborAmt + indirectAmt
    finalBranches = [
      {
        id: `${wo.id}-labor-synthetic`,
        branch_no: '00',
        part_key: `${wo.order_no}-00`,
        part_name: '工賃',
        product_code: null,
        bom_quantity: laborQty,
        unit_cost: LABOR_UNIT_PRICE,
        subtotal: lineTotal,
        notes: null,
        synced_at: null,
        cost_items: [
          {
            id: `${wo.id}-labor-item`,
            product_code: '',
            part_name: '工賃',
            spec: `所要時間 ${stdMinutes}分`,
            quantity: laborQty,
            unit_price: LABOR_UNIT_PRICE,
            material_cost: 0,
            labor_cost: laborAmt,
            indirect_cost: indirectAmt,
            line_total: lineTotal,
            cost_type: '加',
          },
        ],
      },
      ...branchesWithItems,
    ]
  }

  const summary = summarizeBomBranches(finalBranches)
  return { branches: finalBranches, ...summary }
}

export async function listWorkOrderBomSummaries(
  supabase: SupabaseClient,
  filter: 'all' | 'bom' = 'bom'
): Promise<{ rows: WorkOrderBomSummaryRow[]; totals: Omit<WorkOrderBomSummaryRow, 'work_order_id' | 'order_no' | 'product_name' | 'branch_count'> }> {
  const { data: workOrders, error: woErr } = await supabase
    .from('work_orders')
    .select('id, order_no, product_name, bom_model, cost_mode, standard_duration_minutes')
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
  const { data: branchRows, error: brErr } = await supabase
    .from('work_order_branches')
    .select('*')
    .in('work_order_id', workOrderIds)
    .order('branch_no', { ascending: true })

  if (brErr) throw brErr

  const branchesByWorkOrderId = new Map<string, BranchRow[]>()
  for (const branch of branchRows || []) {
    const list = branchesByWorkOrderId.get(branch.work_order_id) || []
    list.push(branch as BranchRow)
    branchesByWorkOrderId.set(branch.work_order_id, list)
  }

  const prefetch = await prefetchBomCostData(supabase, filtered, branchesByWorkOrderId)

  const rows: WorkOrderBomSummaryRow[] = filtered.map((wo) => {
    const branches = branchesByWorkOrderId.get(wo.id) || []
    const result = aggregateWorkOrderBomCost(wo, branches, prefetch)
    return {
      work_order_id: wo.id,
      order_no: wo.order_no,
      product_name: wo.product_name ?? null,
      material_total: result.material_total,
      indirect_total: result.indirect_total,
      labor_total: result.labor_total,
      grand_total: result.grand_total,
      branch_count: result.branches.length,
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
