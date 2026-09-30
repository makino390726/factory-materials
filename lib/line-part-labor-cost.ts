import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'
import {
  calcLaborIndirectFromLabor,
  LABOR_INDIRECT_RATE,
  LABOR_INDIRECT_RATE_CHANGE_FISCAL_YEAR,
  LABOR_INDIRECT_RATE_FROM_REIWA9,
  laborIndirectRateForFiscalYear,
} from '@/lib/labor-indirect-rate'
import { fetchLineAccumulations, type LineAccumulation } from '@/lib/line-work-accumulation'

export {
  calcLaborIndirectFromLabor,
  LABOR_INDIRECT_RATE,
  LABOR_INDIRECT_RATE_CHANGE_FISCAL_YEAR,
  LABOR_INDIRECT_RATE_FROM_REIWA9,
  laborIndirectRateForFiscalYear,
}
import {
  calcPerUnitDurationMinutes,
  getPlannedPartQuantity,
} from '@/lib/manufacturing-plan-quantity'
import { parseAllocationModels } from '@/lib/part-commonality'
import { resolveTargetStandardDurationMinutes } from '@/lib/process-management'

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
  completed_qty: number
  per_unit_duration_minutes: number | null
  per_unit_labor_cost: number
  per_unit_indirect_cost: number
  settings_confirmed: boolean
  duration_source?: string | null
  uses_work_report?: boolean
}

/** L指令 900番台（902〜909など）は日報工費の自動反映対象外 */
export function isLine900Series(lineCode: string | null | undefined): boolean {
  const digits = String(lineCode || '').match(/9\d{2}/)
  if (!digits) return false
  const n = Number(digits[0])
  return n >= 900 && n <= 999
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

/** 1台あたり平均ST（分）から工費・工費間接費を算出する */
export function quoteLaborFromStMinutes(minutes: number, fiscalYear?: number | null) {
  const stMinutes = Math.round(Number(minutes))
  if (!Number.isFinite(stMinutes) || stMinutes <= 0) {
    return { st_minutes: 0, labor_cost: 0, indirect_cost: 0, formula: '' }
  }
  const laborCost = calcLaborCostFromMinutes(stMinutes)
  const indirectCost = calcLaborIndirectFromLabor(laborCost, fiscalYear)
  return {
    st_minutes: stMinutes,
    labor_cost: laborCost,
    indirect_cost: indirectCost,
    formula: `(${stMinutes}分 ÷ ${UNIT_MINUTES}) × ¥${UNIT_LABOR_COST.toLocaleString('ja-JP')}`,
  }
}

export function resolveLineDurationMinutes(line: LineRow): number {
  return Math.max(0, Number(line.standard_duration_minutes || 0))
}

/** 工程管理の年平均ST合計を優先し、無ければマスタ標準時間 */
export async function resolveLineDurationMinutesPreferred(
  supabase: SupabaseClient,
  line: LineRow,
  cache?: Map<string, { minutes: number; note: string | null }>
): Promise<{ minutes: number; note: string | null }> {
  const key = String(line.line_code || '')
  if (cache?.has(key)) {
    return cache.get(key)!
  }

  try {
    const resolved = await resolveTargetStandardDurationMinutes(supabase, 'line', key)
    const minutes =
      resolved.minutes > 0 ? resolved.minutes : resolveLineDurationMinutes(line)
    const result = {
      minutes,
      note: resolved.minutes > 0 ? resolved.note : null,
    }
    cache?.set(key, result)
    return result
  } catch {
    const result = { minutes: resolveLineDurationMinutes(line), note: null }
    cache?.set(key, result)
    return result
  }
}

export function resolveAssignmentDurationMinutes(
  line: LineRow,
  assignment: Pick<LinePartAssignmentRow, 'ratio'>,
  baseMinutes?: number
): number {
  const base =
    baseMinutes !== undefined ? Math.max(0, baseMinutes) : resolveLineDurationMinutes(line)
  const ratio = Math.max(0, Math.min(100, Number(assignment.ratio || 100)))
  return Math.round((base * ratio) / 100)
}

function buildPreviewFromMinutes(
  assignment: LinePartAssignmentRow,
  line: LineRow,
  totalDuration: number,
  divisorQty: number,
  extras: {
    planned_part_qty?: number
    completed_qty?: number
    duration_source?: string | null
    uses_work_report?: boolean
    fiscalYear?: number | null
  }
): LaborRecalcPreview {
  const perUnitMinutes = calcPerUnitDurationMinutes(totalDuration, divisorQty)
  const labor = calcLaborCostFromMinutes(perUnitMinutes ?? 0)
  return {
    part_key: assignment.part_key,
    line_code: line.line_code,
    common_group_label: assignment.common_group_label ?? null,
    total_duration_minutes: totalDuration,
    planned_part_qty: extras.planned_part_qty ?? 0,
    completed_qty: extras.completed_qty ?? 0,
    per_unit_duration_minutes: perUnitMinutes,
    per_unit_labor_cost: labor,
    per_unit_indirect_cost: calcLaborIndirectFromLabor(labor, extras.fiscalYear),
    settings_confirmed: Boolean(assignment.settings_confirmed),
    duration_source: extras.duration_source ?? null,
    uses_work_report: Boolean(extras.uses_work_report),
  }
}

export async function buildLaborRecalcPreview(
  supabase: SupabaseClient,
  assignment: LinePartAssignmentRow,
  line: LineRow,
  planId?: string | null,
  durationCache?: Map<string, { minutes: number; note: string | null }>,
  accumulation?: LineAccumulation | null,
  fiscalYear?: number | null
): Promise<LaborRecalcPreview> {
  const resolvedYear = fiscalYear ?? getCurrentFiscalYear()
  if (!isLine900Series(line.line_code) && accumulation && accumulation.completed_qty > 0) {
    const totalDuration = resolveAssignmentDurationMinutes(
      line,
      assignment,
      accumulation.duration_minutes
    )
    return buildPreviewFromMinutes(assignment, line, totalDuration, accumulation.completed_qty, {
      completed_qty: accumulation.completed_qty,
      duration_source: '作業日報の所要時間 ÷ 完成個数',
      uses_work_report: true,
      fiscalYear: resolvedYear,
    })
  }

  const allocationModels = parseAllocationModels(assignment.allocation_models)
  const duration = await resolveLineDurationMinutesPreferred(supabase, line, durationCache)
  const totalDuration = resolveAssignmentDurationMinutes(line, assignment, duration.minutes)
  const planned = await getPlannedPartQuantity(
    supabase,
    assignment.part_key,
    planId,
    allocationModels
  )

  return buildPreviewFromMinutes(
    assignment,
    line,
    totalDuration,
    planned.planned_part_qty,
    {
      planned_part_qty: planned.planned_part_qty,
      duration_source: duration.note,
      uses_work_report: false,
      fiscalYear: resolvedYear,
    }
  )
}

/** 1件のL指令パーツ割り当てについて労賃を再計算して保存 */
export async function recalculateAssignmentLabor(
  _supabase: SupabaseClient,
  assignment: LinePartAssignmentRow,
  line: LineRow,
  _options?: {
    planId?: string | null
    requireConfirmed?: boolean
    durationCache?: Map<string, { minutes: number; note: string | null }>
    accumulation?: LineAccumulation | null
    fiscalYear?: number
  }
): Promise<LaborRecalcResult> {
  return {
    part_key: assignment.part_key,
    line_code: line.line_code,
    common_group_label: assignment.common_group_label ?? null,
    total_duration_minutes: 0,
    planned_part_qty: 0,
    completed_qty: 0,
    per_unit_duration_minutes: null,
    per_unit_labor_cost: 0,
    per_unit_indirect_cost: 0,
    settings_confirmed: Boolean(assignment.settings_confirmed),
    success: false,
    skipped: true,
    reason: 'L指令の工費は日報の指令コード単位で全体計上するため、パーツ別には計算しません',
  }
}

export async function bulkRecalculateConfirmedAssignments(
  supabase: SupabaseClient,
  options?: { planId?: string | null; onlyConfirmed?: boolean; fiscalYear?: number }
) {
  const onlyConfirmed = options?.onlyConfirmed !== false
  const fiscalYear = options?.fiscalYear ?? getCurrentFiscalYear()

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
  const durationCache = new Map<string, { minutes: number; note: string | null }>()
  const accumulations = await fetchLineAccumulations(supabase, fiscalYear).catch(
    () => new Map<string, LineAccumulation>()
  )
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
        completed_qty: 0,
        per_unit_duration_minutes: null,
        per_unit_labor_cost: 0,
        per_unit_indirect_cost: 0,
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
        {
          planId: options?.planId,
          requireConfirmed: onlyConfirmed,
          durationCache,
          accumulation: accumulations.get(line.id) || null,
          fiscalYear,
        }
      )
      results.push(result)
    } catch (err) {
      results.push({
        part_key: assignment.part_key,
        line_code: line.line_code,
        common_group_label: assignment.common_group_label ?? null,
        total_duration_minutes: 0,
        planned_part_qty: 0,
        completed_qty: 0,
        per_unit_duration_minutes: null,
        per_unit_labor_cost: 0,
        per_unit_indirect_cost: 0,
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

/** 日報確定後、900番台以外のL指令パーツ工費を所要時間÷完成個数で自動更新する */
export async function syncTouchedLineLaborFromWorkReports(
  supabase: SupabaseClient,
  lineCodes: Iterable<string>,
  fiscalYear = getCurrentFiscalYear()
) {
  const codes = [...new Set([...lineCodes].map((code) => String(code || '').trim()).filter(Boolean))].filter(
    (code) => !isLine900Series(code)
  )
  if (codes.length === 0) return { updated: 0, skipped: 0 }

  const { data: lines, error: lineError } = await supabase
    .from('lines')
    .select('id, line_code, name, standard_duration_minutes')
    .in('line_code', codes)

  if (lineError) throw lineError
  const targetLines = (lines || []).filter((line) => !isLine900Series(line.line_code)) as LineRow[]
  if (targetLines.length === 0) return { updated: 0, skipped: 0 }

  const lineIds = targetLines.map((line) => line.id)
  const { data: assignments, error: assignmentError } = await supabase
    .from('line_part_assignments')
    .select('*')
    .in('line_id', lineIds)

  if (assignmentError) throw assignmentError
  if (!assignments || assignments.length === 0) return { updated: 0, skipped: 0 }

  const accumulations = await fetchLineAccumulations(supabase, fiscalYear)
  const lineMap = new Map(targetLines.map((line) => [line.id, line]))
  let updated = 0
  let skipped = 0

  for (const assignment of assignments) {
    const line = lineMap.get(assignment.line_id)
    if (!line) continue
    const result = await recalculateAssignmentLabor(
      supabase,
      assignment as LinePartAssignmentRow,
      line,
      {
        requireConfirmed: false,
        accumulation: accumulations.get(line.id) || null,
        fiscalYear,
      }
    )
    if (result.success) updated += 1
    else skipped += 1
  }

  return { updated, skipped }
}
