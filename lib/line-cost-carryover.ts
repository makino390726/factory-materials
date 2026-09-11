import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'

const LINE_MASTER_TYPE = 'ライン原価'

type CostHeader = {
  id: string
  order_no: string | null
  fiscal_year?: number | null
  total_material_cost?: number | null
  total_labor_cost?: number | null
  total_indirect_cost?: number | null
  total_cost?: number | null
  updated_at?: string | null
  created_at?: string | null
}

type CostItem = {
  id?: string
  work_order_cost_id?: string
  line_no?: number | null
  component_name?: string | null
  product_code?: string | null
  part_name?: string | null
  spec?: string | null
  quantity?: number | null
  unit_price?: number | null
  material_cost?: number | null
  labor_cost?: number | null
  indirect_cost?: number | null
  line_total?: number | null
  cost_type?: string | null
  master_type?: string | null
  master_id?: string | null
  part_key?: string | null
}

function hasMissingColumnError(error: { message?: string } | null, column: string) {
  return Boolean(error?.message && error.message.includes(column))
}

function latestHeader(headers: CostHeader[]) {
  return [...headers].sort((a, b) => {
    const aTime = String(a.updated_at || a.created_at || '')
    const bTime = String(b.updated_at || b.created_at || '')
    return bTime.localeCompare(aTime)
  })[0]
}

export async function loadLineCostForPartYear(
  supabase: SupabaseClient,
  partKey: string,
  fiscalYear: number,
  options?: { allowUntaggedFallback?: boolean; allowPreviousYearFallback?: boolean }
): Promise<{ header: CostHeader; items: CostItem[] } | null> {
  const { data: items, error: itemsError } = await supabase
    .from('work_order_cost_items')
    .select('*')
    .eq('master_type', LINE_MASTER_TYPE)
    .eq('master_id', partKey)
    .order('line_no', { ascending: true })

  if (itemsError) throw itemsError
  if (!items || items.length === 0) return null

  const headerIds = [...new Set(items.map((row) => String(row.work_order_cost_id || '')).filter(Boolean))]
  if (headerIds.length === 0) return { header: { id: '', order_no: null }, items }

  const withYear = await supabase
    .from('work_order_costs')
    .select(
      'id, order_no, fiscal_year, total_material_cost, total_labor_cost, total_indirect_cost, total_cost, updated_at, created_at'
    )
    .in('id', headerIds)

  let headers = (withYear.data || []) as CostHeader[]
  if (withYear.error && hasMissingColumnError(withYear.error, 'fiscal_year')) {
    const fallback = await supabase
      .from('work_order_costs')
      .select(
        'id, order_no, total_material_cost, total_labor_cost, total_indirect_cost, total_cost, updated_at, created_at'
      )
      .in('id', headerIds)
    if (fallback.error) throw fallback.error
    headers = (fallback.data || []) as CostHeader[]
  } else if (withYear.error) {
    throw withYear.error
  }

  const yearHeaders = headers.filter((header) => Number(header.fiscal_year) === fiscalYear)
  const untaggedHeaders = headers.filter((header) => header.fiscal_year == null)
  const previousHeaders = headers.filter((header) => Number(header.fiscal_year) === fiscalYear - 1)
  const sourceHeaders =
    yearHeaders.length > 0
      ? yearHeaders
      : options?.allowUntaggedFallback !== false && untaggedHeaders.length > 0
        ? untaggedHeaders
        : options?.allowPreviousYearFallback
          ? previousHeaders
          : []
  if (sourceHeaders.length === 0) return null
  const header = latestHeader(sourceHeaders)
  return {
    header,
    items: items.filter((row) => String(row.work_order_cost_id) === header.id),
  }
}

function totalsFromCarriedItems(items: Array<{ material_cost?: number | null; indirect_cost?: number | null }>) {
  const material = items.reduce((sum, row) => sum + Math.round(Number(row.material_cost || 0)), 0)
  const materialIndirect = items.reduce((sum, row) => sum + Math.round(Number(row.indirect_cost || 0)), 0)
  return {
    total_material_cost: material,
    total_labor_cost: 0,
    total_indirect_cost: materialIndirect,
    total_cost: material + materialIndirect,
    material,
    materialIndirect,
  }
}

function buildLineOrderNo(partKey: string, fiscalYear: number) {
  return `LINE-${partKey}-FY${fiscalYear}`
}

export type LineCostCarryOverResult = {
  from_year: number
  to_year: number
  copied: number
  skipped: number
  updated_parts: number
  assignment_count: number
  details: Array<{ part_key: string; status: 'copied' | 'skipped'; reason?: string }>
}

/** 前年度の L指令→パーツ→構成部品を現年度へ繰越す。工費は繰越さない。 */
export async function carryOverLineCostsFromPreviousYear(
  supabase: SupabaseClient,
  options?: { fromYear?: number; toYear?: number }
): Promise<LineCostCarryOverResult> {
  const toYear = options?.toYear ?? getCurrentFiscalYear()
  const fromYear = options?.fromYear ?? toYear - 1
  const details: LineCostCarryOverResult['details'] = []

  const { data: assignments, error: assignmentError } = await supabase
    .from('line_part_assignments')
    .select('line_id, part_key, ratio')
  if (assignmentError) throw assignmentError
  const assignmentCount = assignments?.length || 0
  const assignedPartKeys = [
    ...new Set((assignments || []).map((row) => String(row.part_key || '').trim()).filter(Boolean)),
  ]

  const { data: items, error: itemsError } = await supabase
    .from('work_order_cost_items')
    .select('*')
    .eq('master_type', LINE_MASTER_TYPE)
    .order('line_no', { ascending: true })

  if (itemsError) throw itemsError
  const allItems = (items || []) as CostItem[]
  if (allItems.length === 0) {
    return {
      from_year: fromYear,
      to_year: toYear,
      copied: 0,
      skipped: 0,
      updated_parts: 0,
      assignment_count: assignmentCount,
      details,
    }
  }

  const headerIds = [...new Set(allItems.map((row) => String(row.work_order_cost_id || '')).filter(Boolean))]
  const withYear = await supabase
    .from('work_order_costs')
    .select(
      'id, order_no, fiscal_year, total_material_cost, total_labor_cost, total_indirect_cost, total_cost, updated_at, created_at'
    )
    .in('id', headerIds)

  let headers = (withYear.data || []) as CostHeader[]
  if (withYear.error && hasMissingColumnError(withYear.error, 'fiscal_year')) {
    throw new Error(
      'work_order_costs.fiscal_year 列がありません。Supabaseで migrate-add-work-order-cost-fiscal-year.sql を実行してください。'
    )
  }
  if (withYear.error) throw withYear.error

  const headerById = new Map(headers.map((header) => [header.id, header]))
  // L指令→パーツの対応はマスタとして継続。繰越対象は割り当て済みパーツの構成部品のみ。
  const partKeys = assignedPartKeys

  let copied = 0
  let skipped = 0
  let updatedParts = 0

  for (const partKey of partKeys) {
    const partItems = allItems.filter((row) => String(row.master_id || '').trim() === partKey)
    const partHeaders = partItems
      .map((row) => headerById.get(String(row.work_order_cost_id || '')))
      .filter(Boolean) as CostHeader[]

    const toHeaders = partHeaders.filter((header) => Number(header.fiscal_year) === toYear)
    if (toHeaders.length > 0) {
      skipped += 1
      details.push({ part_key: partKey, status: 'skipped', reason: `${toYear}年度の原価が既にあります` })
      continue
    }

    const fromHeaders = partHeaders.filter(
      (header) => Number(header.fiscal_year) === fromYear || header.fiscal_year == null
    )
    const sourcePool = fromHeaders.length > 0 ? fromHeaders : partHeaders
    if (sourcePool.length === 0) {
      skipped += 1
      details.push({
        part_key: partKey,
        status: 'skipped',
        reason: `${fromYear}年度の構成部品がありません`,
      })
      continue
    }

    const sourceHeader = latestHeader(sourcePool)
    const sourceItems = partItems.filter((row) => String(row.work_order_cost_id) === sourceHeader.id)
    const carriedItems = sourceItems.map((row, index) => {
      const material = Math.round(Number(row.material_cost || 0))
      const materialIndirect = Math.round(Number(row.indirect_cost || 0))
      return {
        line_no: Number(row.line_no || index + 1),
        component_name: row.component_name ?? null,
        product_code: row.product_code ?? null,
        part_name: row.part_name ?? null,
        spec: row.spec ?? null,
        quantity: row.quantity ?? 0,
        unit_price: row.unit_price ?? 0,
        material_cost: material,
        labor_cost: 0,
        indirect_cost: materialIndirect,
        line_total: material + materialIndirect,
        cost_type: row.cost_type || '加',
        master_type: LINE_MASTER_TYPE,
        master_id: partKey,
        part_key: row.part_key || partKey,
      }
    })
    const totals = totalsFromCarriedItems(carriedItems)

    const { data: created, error: insertHeaderError } = await supabase
      .from('work_order_costs')
      .insert({
        order_no: buildLineOrderNo(partKey, toYear),
        work_order_id: null,
        fiscal_year: toYear,
        total_material_cost: totals.total_material_cost,
        total_labor_cost: 0,
        total_indirect_cost: totals.total_indirect_cost,
        total_cost: totals.total_cost,
      })
      .select('id')
      .single()

    if (insertHeaderError || !created) {
      throw insertHeaderError || new Error(`${partKey} のヘッダ作成に失敗しました`)
    }

    if (carriedItems.length > 0) {
      const { error: insertItemsError } = await supabase.from('work_order_cost_items').insert(
        carriedItems.map((row) => ({
          ...row,
          work_order_cost_id: created.id,
        }))
      )
      if (insertItemsError) throw insertItemsError
    }

    const { error: partError } = await supabase
      .from('heater_parts_master')
      .update({
        material_cost_total: totals.material,
        indirect_cost_total: totals.materialIndirect,
        cost_price: totals.total_cost,
        updated_at: new Date().toISOString(),
      })
      .eq('part_key', partKey)

    if (!partError) updatedParts += 1

    copied += 1
    details.push({ part_key: partKey, status: 'copied' })
  }

  return {
    from_year: fromYear,
    to_year: toYear,
    copied,
    skipped,
    updated_parts: updatedParts,
    assignment_count: assignmentCount,
    details,
  }
}

export function combineLineCostTotals(params: {
  material: number
  materialIndirect: number
  labor: number
}) {
  const laborIndirect =
    Number.isFinite(params.labor) && params.labor > 0 ? Math.round(params.labor * 0.3) : 0
  return {
    total_material_cost: params.material,
    total_labor_cost: params.labor,
    total_indirect_cost: params.materialIndirect + laborIndirect,
    total_cost: params.material + params.materialIndirect + params.labor + laborIndirect,
    labor_indirect: laborIndirect,
  }
}
