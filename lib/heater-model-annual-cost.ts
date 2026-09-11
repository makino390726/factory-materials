import type { SupabaseClient } from '@supabase/supabase-js'
import { formatFiscalYearLabel, getCurrentFiscalYear } from '@/lib/fiscal-year'

export const ANNUAL_MODEL_COST_ORDER_PREFIX = 'MODELFY:'
export const ANNUAL_MODEL_COST_MASTER_TYPE = '機種年度原価'

export type AnnualModelCost = {
  model: string
  fiscal_year: number
  fiscal_year_label: string
  material_cost: number
  labor_cost: number
  indirect_cost: number
  total_cost: number
  st_minutes: number | null
  applied_label: string | null
  updated_at: string | null
}

function hasMissingColumnError(error: { message?: string } | null, column: string) {
  return Boolean(error?.message && error.message.includes(`Could not find the '${column}' column`))
}

export function annualModelCostOrderNo(fiscalYear: number, model: string) {
  return `${ANNUAL_MODEL_COST_ORDER_PREFIX}${fiscalYear}:${model.trim()}`
}

export function parseAnnualModelCostOrderNo(orderNo: string): { fiscalYear: number; model: string } | null {
  const raw = String(orderNo || '')
  if (!raw.startsWith(ANNUAL_MODEL_COST_ORDER_PREFIX)) return null
  const rest = raw.slice(ANNUAL_MODEL_COST_ORDER_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep < 0) return null
  const fiscalYear = Number(rest.slice(0, sep))
  const model = rest.slice(sep + 1).trim()
  if (!Number.isFinite(fiscalYear) || fiscalYear < 2000 || !model) return null
  return { fiscalYear, model }
}

export async function listAnnualModelCosts(
  supabase: SupabaseClient,
  fiscalYear: number
): Promise<Map<string, AnnualModelCost>> {
  const map = new Map<string, AnnualModelCost>()
  const { data: items, error } = await supabase
    .from('work_order_cost_items')
    .select(
      'master_id, material_cost, labor_cost, indirect_cost, line_total, quantity, part_name, work_order_cost_id'
    )
    .eq('master_type', ANNUAL_MODEL_COST_MASTER_TYPE)
    .order('created_at', { ascending: false })

  if (error) throw error
  if (!items || items.length === 0) return map

  const headerIds = [...new Set(items.map((row) => String(row.work_order_cost_id || '')).filter(Boolean))]
  const headerById = new Map<string, { fiscal_year: number | null; order_no: string; updated_at: string | null }>()

  for (let i = 0; i < headerIds.length; i += 150) {
    const chunk = headerIds.slice(i, i + 150)
    const withYear = await supabase
      .from('work_order_costs')
      .select('id, fiscal_year, order_no, updated_at')
      .in('id', chunk)

    if (withYear.error && hasMissingColumnError(withYear.error, 'fiscal_year')) {
      const fallback = await supabase.from('work_order_costs').select('id, order_no, updated_at').in('id', chunk)
      if (fallback.error) throw fallback.error
      for (const header of fallback.data || []) {
        const parsed = parseAnnualModelCostOrderNo(String(header.order_no || ''))
        headerById.set(String(header.id), {
          fiscal_year: parsed?.fiscalYear ?? null,
          order_no: String(header.order_no || ''),
          updated_at: header.updated_at ? String(header.updated_at) : null,
        })
      }
    } else if (withYear.error) {
      throw withYear.error
    } else {
      for (const header of withYear.data || []) {
        const parsed = parseAnnualModelCostOrderNo(String(header.order_no || ''))
        const year = header.fiscal_year != null ? Number(header.fiscal_year) : parsed?.fiscalYear ?? null
        headerById.set(String(header.id), {
          fiscal_year: Number.isFinite(Number(year)) ? Number(year) : null,
          order_no: String(header.order_no || ''),
          updated_at: header.updated_at ? String(header.updated_at) : null,
        })
      }
    }
  }

  for (const item of items) {
    const header = headerById.get(String(item.work_order_cost_id || ''))
    const parsed = parseAnnualModelCostOrderNo(header?.order_no || '')
    const year = Number(header?.fiscal_year ?? parsed?.fiscalYear)
    if (year !== fiscalYear) continue
    const model = String(item.master_id || parsed?.model || '').trim()
    if (!model || map.has(model)) continue
    const material = Math.round(Number(item.material_cost || 0))
    const labor = Math.round(Number(item.labor_cost || 0))
    const indirect = Math.round(Number(item.indirect_cost || 0))
    map.set(model, {
      model,
      fiscal_year: year,
      fiscal_year_label: formatFiscalYearLabel(year),
      material_cost: material,
      labor_cost: labor,
      indirect_cost: indirect,
      total_cost: Math.round(Number(item.line_total || material + labor + indirect)),
      st_minutes: Number(item.quantity || 0) > 0 ? Math.round(Number(item.quantity)) : null,
      applied_label: item.part_name ? String(item.part_name) : null,
      updated_at: header?.updated_at || null,
    })
  }

  return map
}

export async function saveAnnualModelCost(
  supabase: SupabaseClient,
  input: {
    model: string
    fiscal_year?: number
    material_cost: number
    labor_cost: number
    indirect_cost: number
    total_cost?: number
    st_minutes?: number | null
    applied_label?: string | null
    note?: string | null
  }
): Promise<AnnualModelCost> {
  const model = input.model.trim()
  if (!model) throw new Error('model が必要です')
  const fiscalYear = Number(input.fiscal_year || getCurrentFiscalYear())
  if (!Number.isFinite(fiscalYear) || fiscalYear < 2000) throw new Error('fiscal_year が不正です')

  const material = Math.round(Number(input.material_cost || 0))
  const labor = Math.round(Number(input.labor_cost || 0))
  const indirect = Math.round(Number(input.indirect_cost || 0))
  const total = Math.round(Number(input.total_cost || material + labor + indirect))
  const stMinutes = Math.round(Number(input.st_minutes || 0))
  const orderNo = annualModelCostOrderNo(fiscalYear, model)
  const now = new Date().toISOString()
  const label = input.applied_label || `${formatFiscalYearLabel(fiscalYear)}原価`

  const { data: existing } = await supabase
    .from('work_order_costs')
    .select('id')
    .eq('order_no', orderNo)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const headerPayload: Record<string, unknown> = {
    order_no: orderNo,
    work_order_id: null,
    total_material_cost: material,
    total_labor_cost: labor,
    total_indirect_cost: indirect,
    total_cost: total,
    fiscal_year: fiscalYear,
    updated_at: now,
  }

  let headerId = existing?.id ? String(existing.id) : ''
  if (headerId) {
    const updated = await supabase.from('work_order_costs').update(headerPayload).eq('id', headerId)
    if (updated.error && hasMissingColumnError(updated.error, 'fiscal_year')) {
      delete headerPayload.fiscal_year
      const retry = await supabase.from('work_order_costs').update(headerPayload).eq('id', headerId)
      if (retry.error) throw retry.error
    } else if (updated.error) {
      throw updated.error
    }
  } else {
    const inserted = await supabase.from('work_order_costs').insert(headerPayload).select('id').single()
    if (inserted.error && hasMissingColumnError(inserted.error, 'fiscal_year')) {
      delete headerPayload.fiscal_year
      const retry = await supabase.from('work_order_costs').insert(headerPayload).select('id').single()
      if (retry.error) throw retry.error
      headerId = String(retry.data.id)
    } else if (inserted.error) {
      throw inserted.error
    } else {
      headerId = String(inserted.data.id)
    }
  }

  await supabase.from('work_order_cost_items').delete().eq('work_order_cost_id', headerId)

  const { error: itemError } = await supabase.from('work_order_cost_items').insert({
    work_order_cost_id: headerId,
    line_no: 1,
    master_type: ANNUAL_MODEL_COST_MASTER_TYPE,
    master_id: model,
    part_name: label,
    component_name: input.note || null,
    spec: JSON.stringify({ fiscal_year: fiscalYear, note: input.note || '' }),
    quantity: stMinutes,
    unit_price: 0,
    material_cost: material,
    labor_cost: labor,
    indirect_cost: indirect,
    line_total: total,
    cost_type: '加',
  })
  if (itemError) throw itemError

  return {
    model,
    fiscal_year: fiscalYear,
    fiscal_year_label: formatFiscalYearLabel(fiscalYear),
    material_cost: material,
    labor_cost: labor,
    indirect_cost: indirect,
    total_cost: total,
    st_minutes: stMinutes > 0 ? stMinutes : null,
    applied_label: label,
    updated_at: now,
  }
}
