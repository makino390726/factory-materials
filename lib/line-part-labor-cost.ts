import type { SupabaseClient } from '@supabase/supabase-js'
import {
  calcPerUnitDurationMinutes,
  getPlannedPartQuantity,
} from '@/lib/manufacturing-plan-quantity'
import { parseAllocationModels } from '@/lib/part-commonality'

export const UNIT_LABOR_COST = 17810
export const UNIT_MINUTES = 480

export type LinePartAssignmentRow = {
  id: string
  line_id: string
  part_key: string
  ratio: number
  common_group_label?: string | null
  allocation_models?: unknown
  bom_model_count?: number | null
  common_group_source?: string | null
  settings_confirmed?: boolean | null
  settings_confirmed_at?: string | null
  labor_recalc_at?: string | null
}

export type LineRow = {
  id: string
  line_code: string
  name: string
  standard_duration_minutes: number | null
}

export type LaborRecalcPreview = {
  part_key: string
  line_code: string
  common_group_label: string | null
  total_duration_minutes: number
  planned_part_qty: number
  per_unit_duration_minutes: number | null
  per_unit_labor_cost: number
  settings_confirmed: boolean
}

export type LaborRecalcResult = LaborRecalcPreview & {
  success: boolean
  skipped?: boolean
  reason?: string
  total_cost?: number
}

export function calcLaborCostFromMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.round((minutes / UNIT_MINUTES) * UNIT_LABOR_COST)
}

export function resolveLineDurationMinutes(line: LineRow): number {
  return Math.max(0, Number(line.standard_duration_minutes || 0))
}

export function resolveAssignmentDurationMinutes(
  line: LineRow,
  assignment: Pick<LinePartAssignmentRow, 'ratio'>
): number {
  const base = resolveLineDurationMinutes(line)
  const ratio = Math.max(0, Math.min(100, Number(assignment.ratio || 100)))
  return Math.round((base * ratio) / 100)
}

export async function buildLaborRecalcPreview(
  supabase: SupabaseClient,
  assignment: LinePartAssignmentRow,
  line: LineRow,
  planId?: string | null
): Promise<LaborRecalcPreview> {
  const allocationModels = parseAllocationModels(assignment.allocation_models)
  const totalDuration = resolveAssignmentDurationMinutes(line, assignment)
  const planned = await getPlannedPartQuantity(
    supabase,
    assignment.part_key,
    planId,
    allocationModels
  )
  const perUnitMinutes = calcPerUnitDurationMinutes(
    totalDuration,
    planned.planned_part_qty
  )

  return {
    part_key: assignment.part_key,
    line_code: line.line_code,
    common_group_label: assignment.common_group_label ?? null,
    total_duration_minutes: totalDuration,
    planned_part_qty: planned.planned_part_qty,
    per_unit_duration_minutes: perUnitMinutes,
    per_unit_labor_cost: calcLaborCostFromMinutes(perUnitMinutes ?? 0),
    settings_confirmed: Boolean(assignment.settings_confirmed),
  }
}

function buildLineOrderNo(partKey: string) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `LINE-${partKey}-${timestamp}`
}

/** 1件のL指令パーツ割り当てについて労賃を再計算して保存 */
export async function recalculateAssignmentLabor(
  supabase: SupabaseClient,
  assignment: LinePartAssignmentRow,
  line: LineRow,
  options?: { planId?: string | null; requireConfirmed?: boolean }
): Promise<LaborRecalcResult> {
  const preview = await buildLaborRecalcPreview(
    supabase,
    assignment,
    line,
    options?.planId
  )

  if (options?.requireConfirmed && !assignment.settings_confirmed) {
    return { ...preview, success: false, skipped: true, reason: '設定未確認' }
  }

  if (!preview.per_unit_duration_minutes || preview.planned_part_qty <= 0) {
    return {
      ...preview,
      success: false,
      skipped: true,
      reason: '制作所要時間または製造計画部品数が未設定',
    }
  }

  const { data: existingItems, error: itemsError } = await supabase
    .from('work_order_cost_items')
    .select('*')
    .eq('master_type', 'ライン原価')
    .eq('master_id', assignment.part_key)
    .order('line_no', { ascending: true })

  if (itemsError) throw itemsError

  const materialTotal = (existingItems || []).reduce(
    (sum, row) => sum + Number(row.material_cost || 0),
    0
  )
  const itemLaborTotal = (existingItems || []).reduce(
    (sum, row) => sum + Number(row.labor_cost || 0),
    0
  )
  const itemIndirectTotal = (existingItems || []).reduce(
    (sum, row) => sum + Number(row.indirect_cost || 0),
    0
  )

  const headerLabor = preview.per_unit_labor_cost
  const laborIndirect = Math.round((materialTotal + headerLabor + itemLaborTotal) * 0.3)
  const totalCost = materialTotal + itemLaborTotal + itemIndirectTotal + headerLabor + laborIndirect

  const existingHeaderId = existingItems?.[0]?.work_order_cost_id
    ? String(existingItems[0].work_order_cost_id)
    : null

  const headerPayload = {
    total_material_cost: materialTotal,
    total_labor_cost: headerLabor,
    total_indirect_cost: laborIndirect,
    total_cost: totalCost,
    updated_at: new Date().toISOString(),
  }

  if (existingHeaderId) {
    const { error: updateHeaderError } = await supabase
      .from('work_order_costs')
      .update(headerPayload)
      .eq('id', existingHeaderId)

    if (updateHeaderError) throw updateHeaderError
  } else {
    const { error: insertHeaderError } = await supabase.from('work_order_costs').insert({
      order_no: buildLineOrderNo(assignment.part_key),
      work_order_id: null,
      ...headerPayload,
    })

    if (insertHeaderError) throw insertHeaderError
  }

  const { error: partUpdateError } = await supabase
    .from('heater_parts_master')
    .update({
      cost_price: totalCost,
      updated_at: new Date().toISOString(),
    })
    .eq('part_key', assignment.part_key)

  if (partUpdateError) throw partUpdateError

  const now = new Date().toISOString()
  const { error: assignmentUpdateError } = await supabase
    .from('line_part_assignments')
    .update({ labor_recalc_at: now, updated_at: now })
    .eq('id', assignment.id)

  if (assignmentUpdateError) throw assignmentUpdateError

  return {
    ...preview,
    success: true,
    total_cost: totalCost,
  }
}

export async function bulkRecalculateConfirmedAssignments(
  supabase: SupabaseClient,
  options?: { planId?: string | null; onlyConfirmed?: boolean }
) {
  const onlyConfirmed = options?.onlyConfirmed !== false

  const { data: assignments, error: assignmentError } = await supabase
    .from('line_part_assignments')
    .select('*')
    .order('part_key', { ascending: true })

  if (assignmentError) throw assignmentError

  const lineIds = [...new Set((assignments || []).map((row) => row.line_id))]
  const { data: lines, error: lineError } = await supabase
    .from('lines')
    .select('id, line_code, name, standard_duration_minutes')
    .in('id', lineIds.length > 0 ? lineIds : ['00000000-0000-0000-0000-000000000000'])

  if (lineError) throw lineError

  const lineMap = new Map((lines || []).map((line) => [line.id, line as LineRow]))
  const results: LaborRecalcResult[] = []

  for (const assignment of assignments || []) {
    const line = lineMap.get(assignment.line_id)
    if (!line) {
      results.push({
        part_key: assignment.part_key,
        line_code: '-',
        common_group_label: assignment.common_group_label ?? null,
        total_duration_minutes: 0,
        planned_part_qty: 0,
        per_unit_duration_minutes: null,
        per_unit_labor_cost: 0,
        settings_confirmed: Boolean(assignment.settings_confirmed),
        success: false,
        skipped: true,
        reason: 'L指令が見つかりません',
      })
      continue
    }

    try {
      const result = await recalculateAssignmentLabor(
        supabase,
        assignment as LinePartAssignmentRow,
        line,
        { planId: options?.planId, requireConfirmed: onlyConfirmed }
      )
      results.push(result)
    } catch (err) {
      results.push({
        part_key: assignment.part_key,
        line_code: line.line_code,
        common_group_label: assignment.common_group_label ?? null,
        total_duration_minutes: 0,
        planned_part_qty: 0,
        per_unit_duration_minutes: null,
        per_unit_labor_cost: 0,
        settings_confirmed: Boolean(assignment.settings_confirmed),
        success: false,
        reason: err instanceof Error ? err.message : '再計算に失敗',
      })
    }
  }

  return {
    total: results.length,
    success_count: results.filter((row) => row.success).length,
    skipped_count: results.filter((row) => row.skipped).length,
    failed_count: results.filter((row) => !row.success && !row.skipped).length,
    results,
  }
}
