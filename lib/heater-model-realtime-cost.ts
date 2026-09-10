import type { SupabaseClient } from '@supabase/supabase-js'

export const REALTIME_COST_ORDER_PREFIX = 'RTMODEL:'
export const REALTIME_COST_MASTER_TYPE = '機種リアルタイム原価'

export type SavedModelRealtimeCost = {
  model: string
  st_minutes: number
  labor_cost: number
  indirect_cost: number
  applied_label: string | null
  formula: string | null
  fiscal_year_label: string | null
  target_type: string | null
  target_code: string | null
  note: string | null
  updated_at: string | null
}

export type ModelRealtimeOverlayBase = {
  material_cost: number
  labor_cost: number
  indirect_cost: number
  total_cost: number
  fee_labor_cost: number
  fee_indirect_cost: number
  has_labor_fee_row: boolean
}

export function isLaborFeePartLabel(...labels: Array<string | null | undefined>): boolean {
  const normalized = labels
    .map((v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ''))
    .filter(Boolean)
  return normalized.some((v) => v === '工費' || v === '工賃' || v.includes('工費') || v.includes('工賃'))
}

export function realtimeCostOrderNo(model: string) {
  return `${REALTIME_COST_ORDER_PREFIX}${model}`
}

export function applyModelRealtimeOverlay(
  base: ModelRealtimeOverlayBase,
  realtime: { labor_cost: number; indirect_cost: number }
) {
  const labor = Math.max(0, Number(realtime.labor_cost || 0))
  const indirect = Math.max(0, Number(realtime.indirect_cost || 0))
  const material = Math.round(Number(base.material_cost || 0))

  if (base.has_labor_fee_row) {
    const nextLabor = Math.round(Number(base.labor_cost || 0) - Number(base.fee_labor_cost || 0) + labor)
    const nextIndirect = Math.round(
      Number(base.indirect_cost || 0) - Number(base.fee_indirect_cost || 0) + indirect
    )
    const nextTotal = Math.round(
      Number(base.total_cost || 0) - Number(base.fee_labor_cost || 0) - Number(base.fee_indirect_cost || 0) + labor + indirect
    )
    return {
      material_cost: material,
      labor_cost: nextLabor,
      indirect_cost: nextIndirect,
      total_cost: nextTotal,
    }
  }

  return {
    material_cost: material,
    labor_cost: Math.round(Number(base.labor_cost || 0) + labor),
    indirect_cost: Math.round(Number(base.indirect_cost || 0) + indirect),
    total_cost: Math.round(Number(base.total_cost || 0) + labor + indirect),
  }
}

function mapSavedRow(row: {
  master_id?: string | null
  labor_cost?: number | null
  indirect_cost?: number | null
  quantity?: number | null
  part_name?: string | null
  spec?: string | null
  component_name?: string | null
  updated_at?: string | null
  created_at?: string | null
}): SavedModelRealtimeCost | null {
  const model = String(row.master_id || '').trim()
  if (!model) return null
  let extra: {
    formula?: string
    fiscal_year_label?: string
    target_type?: string
    target_code?: string
    note?: string
  } = {}
  try {
    extra = JSON.parse(String(row.spec || '')) || {}
  } catch {
    extra = { formula: String(row.spec || '') || undefined }
  }
  const [targetType, targetCode] = String(row.component_name || '').split(':', 2)
  return {
    model,
    st_minutes: Math.round(Number(row.quantity || 0)),
    labor_cost: Math.round(Number(row.labor_cost || 0)),
    indirect_cost: Math.round(Number(row.indirect_cost || 0)),
    applied_label: row.part_name ? String(row.part_name) : null,
    formula: extra.formula || null,
    fiscal_year_label: extra.fiscal_year_label || null,
    target_type: extra.target_type || targetType || null,
    target_code: extra.target_code || targetCode || null,
    note: extra.note || null,
    updated_at: row.updated_at
      ? String(row.updated_at)
      : row.created_at
        ? String(row.created_at)
        : null,
  }
}

export async function listSavedModelRealtimeCosts(
  supabase: SupabaseClient
): Promise<Map<string, SavedModelRealtimeCost>> {
  const { data, error } = await supabase
    .from('work_order_cost_items')
    .select('master_id, labor_cost, indirect_cost, quantity, part_name, spec, component_name, created_at')
    .eq('master_type', REALTIME_COST_MASTER_TYPE)
    .order('created_at', { ascending: false })

  if (error) throw error

  const map = new Map<string, SavedModelRealtimeCost>()
  for (const row of data || []) {
    const saved = mapSavedRow(row)
    if (!saved || map.has(saved.model)) continue
    map.set(saved.model, saved)
  }
  return map
}

export async function getSavedModelRealtimeCost(
  supabase: SupabaseClient,
  model: string
): Promise<SavedModelRealtimeCost | null> {
  const modelKey = model.trim()
  if (!modelKey) return null
  const { data, error } = await supabase
    .from('work_order_cost_items')
    .select('master_id, labor_cost, indirect_cost, quantity, part_name, spec, component_name, created_at')
    .eq('master_type', REALTIME_COST_MASTER_TYPE)
    .eq('master_id', modelKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? mapSavedRow(data) : null
}

export async function saveModelRealtimeCost(
  supabase: SupabaseClient,
  input: {
    model: string
    st_minutes: number
    labor_cost: number
    indirect_cost: number
    applied_label?: string | null
    formula?: string | null
    fiscal_year_label?: string | null
    target_type?: string | null
    target_code?: string | null
    note?: string | null
  }
): Promise<SavedModelRealtimeCost> {
  const model = input.model.trim()
  if (!model) throw new Error('model が必要です')

  const labor = Math.round(Number(input.labor_cost || 0))
  const indirect = Math.round(Number(input.indirect_cost || 0))
  const stMinutes = Math.round(Number(input.st_minutes || 0))
  const orderNo = realtimeCostOrderNo(model)
  const now = new Date().toISOString()
  const spec = JSON.stringify({
    formula: input.formula || '',
    fiscal_year_label: input.fiscal_year_label || '',
    target_type: input.target_type || '',
    target_code: input.target_code || '',
    note: input.note || '',
  })

  const { data: existing } = await supabase
    .from('work_order_costs')
    .select('id')
    .eq('order_no', orderNo)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const headerPayload = {
    order_no: orderNo,
    work_order_id: null,
    total_material_cost: 0,
    total_labor_cost: labor,
    total_indirect_cost: indirect,
    total_cost: labor + indirect,
    updated_at: now,
  }

  let headerId = existing?.id ? String(existing.id) : ''
  if (headerId) {
    const { error } = await supabase.from('work_order_costs').update(headerPayload).eq('id', headerId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('work_order_costs').insert(headerPayload).select('id').single()
    if (error) throw error
    headerId = String(data.id)
  }

  await supabase.from('work_order_cost_items').delete().eq('work_order_cost_id', headerId)

  const { error: itemError } = await supabase.from('work_order_cost_items').insert({
    work_order_cost_id: headerId,
    line_no: 1,
    master_type: REALTIME_COST_MASTER_TYPE,
    master_id: model,
    part_name: input.applied_label || '機種工費',
    component_name: `${input.target_type || ''}:${input.target_code || ''}`,
    spec,
    quantity: stMinutes,
    unit_price: 0,
    material_cost: 0,
    labor_cost: labor,
    indirect_cost: indirect,
    line_total: labor + indirect,
    cost_type: '加',
  })
  if (itemError) throw itemError

  return {
    model,
    st_minutes: stMinutes,
    labor_cost: labor,
    indirect_cost: indirect,
    applied_label: input.applied_label || '機種工費',
    formula: input.formula || null,
    fiscal_year_label: input.fiscal_year_label || null,
    target_type: input.target_type || null,
    target_code: input.target_code || null,
    note: input.note || null,
    updated_at: now,
  }
}
