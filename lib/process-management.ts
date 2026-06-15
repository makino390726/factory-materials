import type { SupabaseClient } from '@supabase/supabase-js'
import { getMonthDateRange } from '@/lib/work-report-monthly-sync'
import {
  formatFiscalYearLabel,
  getFiscalYearDateRange,
} from '@/lib/fiscal-year'
import { formatDurationHours } from '@/lib/work-report-aggregation'

export type ProcessTargetType = 'line' | 'instruction'

export type ProcessTarget = {
  target_type: ProcessTargetType
  target_code: string
  name: string
  subtitle: string | null
}

export type ProcessWorkGroupRow = {
  work_group_code: string
  work_group_name: string
  total_minutes: number
  avg_st_minutes: number | null
  baseline_st_minutes: number | null
  variation_pct: number | null
  is_bottleneck_by_st: boolean
  is_bottleneck_by_variation: boolean
}

export type ProcessDayHistory = {
  work_date: string
  completed_qty: number | null
  receipt_slip_no: string | null
  total_lead_time_st: number | null
}

export type ProductionLotRecord = {
  id: string
  target_type: ProcessTargetType
  target_code: string
  period_start: string
  period_end: string
  completed_qty: number
  receipt_slip_no: string | null
  notes: string | null
}

export type ProductionLotAnalysis = {
  lot: ProductionLotRecord
  is_cumulative: boolean
  total_lead_time_st: number | null
  rows: ProcessWorkGroupRow[]
  bottleneck_by_st: string | null
  bottleneck_by_variation: string | null
}

export type ProductionLotsResult = {
  target_type: ProcessTargetType
  target_code: string
  target_name: string
  suggested_period_start: string | null
  lots: ProductionLotAnalysis[]
}

export type ProcessAnalysisResult = {
  target_type: ProcessTargetType
  target_code: string
  target_name: string
  work_date: string
  completed_qty: number | null
  receipt_slip_no: string | null
  month_completed_qty: number
  rows: ProcessWorkGroupRow[]
  bottleneck_by_st: string | null
  bottleneck_by_variation: string | null
  history_days: ProcessDayHistory[]
}

type DailyOutputRow = {
  work_date: string
  completed_qty: number
  receipt_slip_no: string | null
}

type ReportStaff = {
  id: string
  staffs: { work_group_code: string | null } | { work_group_code: string | null }[] | null
}

type WorkItemRow = {
  report_id: string
  line_id: string | null
  instruction_text: string | null
  is_support: boolean
  support_work_group_code: string | null
  duration_minutes: number
}

type OutputSchema = 'target' | 'line_code'

let cachedOutputSchema: OutputSchema | null = null

export function normalizeTargetCode(code: string) {
  return code.trim()
}

export function normalizeWorkDate(workDate: string) {
  const trimmed = workDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('work_date は YYYY-MM-DD 形式で指定してください')
  }
  return trimmed
}

export function parseProcessTargetKey(key: string): ProcessTarget {
  const [type, ...rest] = key.split(':')
  const code = rest.join(':')
  if ((type !== 'line' && type !== 'instruction') || !code) {
    throw new Error('対象の指定が不正です')
  }
  return {
    target_type: type,
    target_code: normalizeTargetCode(code),
    name: code,
    subtitle: null,
  }
}

export function toProcessTargetKey(targetType: ProcessTargetType, targetCode: string) {
  return `${targetType}:${normalizeTargetCode(targetCode)}`
}

/** 作業日報の D指令 文字列が指令番号に一致するか（枝番付きも許容） */
export function instructionMatchesOrderNo(
  instructionText: string | null | undefined,
  orderNo: string
) {
  const instruction = normalizeTargetCode(instructionText || '')
  const order = normalizeTargetCode(orderNo)
  if (!instruction || !order) return false
  if (instruction === order) return true
  return instruction.startsWith(`${order}-`) || instruction.startsWith(`${order}_`)
}

export function buildProcessManagementPath(
  targetType: ProcessTargetType,
  targetCode: string,
  workDate?: string
) {
  const params = new URLSearchParams({
    target_type: targetType,
    target_code: normalizeTargetCode(targetCode),
  })
  if (workDate) {
    params.set('work_date', normalizeWorkDate(workDate))
  }
  return `/process-management?${params.toString()}`
}

function getStaffWorkGroupCode(report: ReportStaff | undefined) {
  const staffs = report?.staffs
  if (!staffs) return null
  if (Array.isArray(staffs)) return staffs[0]?.work_group_code ?? null
  return staffs.work_group_code
}

function isMissingTableError(error: { code?: string; message?: string }) {
  return error.code === '42P01' || (error.message || '').includes('does not exist')
}

function isMissingColumnError(error: { code?: string; message?: string }, column: string) {
  return error.code === 'PGRST204' && (error.message || '').includes(column)
}

function isOnConflictConstraintError(error: { code?: string; message?: string }) {
  const message = error.message || ''
  return (
    error.code === '42P10' ||
    message.includes('ON CONFLICT specification') ||
    message.includes('no unique or exclusion constraint')
  )
}

export function formatProcessOutputError(error: unknown): Error {
  if (error && typeof error === 'object' && 'message' in error) {
    const record = error as { code?: string; message: string }
    if (isMissingTableError(record)) {
      return new Error(
        'process_daily_outputs テーブルがありません。Supabaseで migrate-process-management-daily.sql を実行してください。'
      )
    }
    if (isMissingColumnError(record, 'target_type')) {
      return new Error(
        'DBが旧形式です。Supabaseで migrate-process-management-daily.sql を実行してください。'
      )
    }
    if (isOnConflictConstraintError(record)) {
      return new Error(
        'upsert用のユニーク制約がありません。Supabaseで migrate-process-management-daily.sql を再実行してください。'
      )
    }
    return new Error(record.message)
  }
  return error instanceof Error ? error : new Error('完成品数の保存に失敗しました')
}

async function detectOutputSchema(supabase: SupabaseClient): Promise<OutputSchema> {
  if (cachedOutputSchema) return cachedOutputSchema

  const { error: targetError } = await supabase
    .from('process_daily_outputs')
    .select('target_type, target_code')
    .limit(0)

  if (!targetError) {
    cachedOutputSchema = 'target'
    return 'target'
  }
  if (!isMissingColumnError(targetError, 'target_type') && !isMissingTableError(targetError)) {
    throw targetError
  }

  const { error: lineCodeError } = await supabase
    .from('process_daily_outputs')
    .select('line_code')
    .limit(0)

  if (!lineCodeError) {
    cachedOutputSchema = 'line_code'
    return 'line_code'
  }
  if (isMissingTableError(lineCodeError)) {
    throw new Error(
      'process_daily_outputs テーブルがありません。Supabaseで migrate-process-management-daily.sql を実行してください。'
    )
  }
  throw lineCodeError
}

async function resolveLineId(supabase: SupabaseClient, lineCode: string) {
  const { data, error } = await supabase
    .from('lines')
    .select('id, line_code, name')
    .eq('line_code', normalizeTargetCode(lineCode))
    .maybeSingle()

  if (error) throw error
  return data
}

async function resolveInstruction(supabase: SupabaseClient, orderNo: string) {
  const code = normalizeTargetCode(orderNo)
  const { data, error } = await supabase
    .from('work_orders')
    .select('order_no, product_name, model')
    .eq('order_no', code)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

/** 指定日・対象の作業グループ別実績時間（分） */
export async function aggregateWorkGroupMinutesOnDate(
  supabase: SupabaseClient,
  workDate: string,
  targetType: ProcessTargetType,
  targetCode: string,
  lineId?: string | null
): Promise<Map<string, number>> {
  const date = normalizeWorkDate(workDate)
  const normalizedCode = normalizeTargetCode(targetCode)

  const { data: reports, error: reportError } = await supabase
    .from('work_reports')
    .select('id, staffs(work_group_code)')
    .eq('work_date', date)
    .eq('is_draft', false)

  if (reportError) throw reportError

  const reportMap = new Map<string, ReportStaff>(
    (reports || []).map((report) => [report.id, report as unknown as ReportStaff])
  )
  const reportIds = Array.from(reportMap.keys())
  const totals = new Map<string, number>()

  if (reportIds.length === 0) return totals

  for (let i = 0; i < reportIds.length; i += 100) {
    const chunkIds = reportIds.slice(i, i + 100)
    let query = supabase
      .from('work_report_items')
      .select(
        'report_id, line_id, instruction_text, is_support, support_work_group_code, duration_minutes'
      )
      .in('report_id', chunkIds)

    if (targetType === 'line' && lineId) {
      query = query.eq('line_id', lineId)
    }

    const { data: items, error: itemError } = await query
    if (itemError) throw itemError

    for (const item of (items || []) as WorkItemRow[]) {
      if (targetType === 'instruction') {
        if (!instructionMatchesOrderNo(item.instruction_text, normalizedCode)) continue
      }

      const report = reportMap.get(item.report_id)
      const workGroupCode = item.is_support
        ? item.support_work_group_code
        : getStaffWorkGroupCode(report)

      if (!workGroupCode) continue

      totals.set(workGroupCode, (totals.get(workGroupCode) || 0) + (item.duration_minutes || 0))
    }
  }

  return totals
}

/** 指定期間・対象の作業グループ別実績時間（分） */
export async function aggregateTargetWorkGroupMinutesInRange(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fromDate: string,
  toDate: string,
  lineId?: string | null
): Promise<Map<string, number>> {
  const start = normalizeWorkDate(fromDate)
  const end = normalizeWorkDate(toDate)
  if (end < start) {
    throw new Error('完成日は製作開始日以降を指定してください')
  }

  const normalizedCode = normalizeTargetCode(targetCode)
  const totals = new Map<string, number>()
  const pageSize = 500
  let offset = 0

  while (true) {
    const { data: reports, error: reportError } = await supabase
      .from('work_reports')
      .select('id, staffs(work_group_code)')
      .gte('work_date', start)
      .lte('work_date', end)
      .eq('is_draft', false)
      .order('work_date', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (reportError) throw reportError

    const batch = reports || []
    if (batch.length === 0) break

    const reportMap = new Map<string, ReportStaff>(
      batch.map((report) => [report.id, report as unknown as ReportStaff])
    )
    const reportIds = Array.from(reportMap.keys())

    for (let i = 0; i < reportIds.length; i += 100) {
      const chunkIds = reportIds.slice(i, i + 100)
      let query = supabase
        .from('work_report_items')
        .select(
          'report_id, line_id, instruction_text, is_support, support_work_group_code, duration_minutes'
        )
        .in('report_id', chunkIds)

      if (targetType === 'line' && lineId) {
        query = query.eq('line_id', lineId)
      }

      const { data: items, error: itemError } = await query
      if (itemError) throw itemError

      for (const item of (items || []) as WorkItemRow[]) {
        if (targetType === 'instruction') {
          if (!instructionMatchesOrderNo(item.instruction_text, normalizedCode)) continue
        }

        const report = reportMap.get(item.report_id)
        const workGroupCode = item.is_support
          ? item.support_work_group_code
          : getStaffWorkGroupCode(report)

        if (!workGroupCode) continue

        totals.set(workGroupCode, (totals.get(workGroupCode) || 0) + (item.duration_minutes || 0))
      }
    }

    if (batch.length < pageSize) break
    offset += pageSize
  }

  return totals
}

async function fetchDailyOutputRow(
  supabase: SupabaseClient,
  workDate: string,
  targetType: ProcessTargetType,
  targetCode: string
) {
  const date = normalizeWorkDate(workDate)
  const normalizedCode = normalizeTargetCode(targetCode)
  const schema = await detectOutputSchema(supabase)

  try {
    if (schema === 'target') {
      const { data, error } = await supabase
        .from('process_daily_outputs')
        .select('completed_qty, receipt_slip_no')
        .eq('work_date', date)
        .eq('target_type', targetType)
        .eq('target_code', normalizedCode)
        .maybeSingle()

      if (error) throw error
      if (!data) return null
      return {
        completed_qty: data.completed_qty ?? null,
        receipt_slip_no: data.receipt_slip_no ?? null,
      }
    }

    if (targetType !== 'line') return null

    const { data, error } = await supabase
      .from('process_daily_outputs')
      .select('completed_qty, receipt_slip_no')
      .eq('work_date', date)
      .eq('line_code', normalizedCode)
      .maybeSingle()

    if (error) throw error
    if (!data) return null
    return {
      completed_qty: data.completed_qty ?? null,
      receipt_slip_no: data.receipt_slip_no ?? null,
    }
  } catch (error) {
    if (isMissingTableError(error as { code?: string; message?: string })) {
      return null
    }
    throw formatProcessOutputError(error)
  }
}

async function fetchDailyOutputsInMonth(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  workDate: string
) {
  const date = normalizeWorkDate(workDate)
  const [year, month] = date.split('-').map(Number)
  const { monthStart, monthEnd } = getMonthDateRange(year, month)
  const normalizedCode = normalizeTargetCode(targetCode)
  const schema = await detectOutputSchema(supabase)

  try {
    if (schema === 'target') {
      const { data, error } = await supabase
        .from('process_daily_outputs')
        .select('work_date, completed_qty, receipt_slip_no')
        .eq('target_type', targetType)
        .eq('target_code', normalizedCode)
        .gte('work_date', monthStart)
        .lte('work_date', monthEnd)
        .order('work_date', { ascending: true })

      if (error) throw error
      return (data || []) as DailyOutputRow[]
    }

    if (targetType !== 'line') return []

    const { data, error } = await supabase
      .from('process_daily_outputs')
      .select('work_date, completed_qty, receipt_slip_no')
      .eq('line_code', normalizedCode)
      .gte('work_date', monthStart)
      .lte('work_date', monthEnd)
      .order('work_date', { ascending: true })

    if (error) throw error
    return (data || []) as DailyOutputRow[]
  } catch (error) {
    if (isMissingTableError(error as { code?: string; message?: string })) {
      return []
    }
    throw formatProcessOutputError(error)
  }
}

async function fetchDailyOutputsBefore(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  beforeDate: string
) {
  const date = normalizeWorkDate(beforeDate)
  const normalizedCode = normalizeTargetCode(targetCode)
  const schema = await detectOutputSchema(supabase)

  try {
    if (schema === 'target') {
      const { data, error } = await supabase
        .from('process_daily_outputs')
        .select('work_date, completed_qty, receipt_slip_no')
        .eq('target_type', targetType)
        .eq('target_code', normalizedCode)
        .lt('work_date', date)
        .gt('completed_qty', 0)
        .order('work_date', { ascending: true })

      if (error) throw error
      return (data || []) as DailyOutputRow[]
    }

    if (targetType !== 'line') return []

    const { data, error } = await supabase
      .from('process_daily_outputs')
      .select('work_date, completed_qty, receipt_slip_no')
      .eq('line_code', normalizedCode)
      .lt('work_date', date)
      .gt('completed_qty', 0)
      .order('work_date', { ascending: true })

    if (error) throw error
    return (data || []) as DailyOutputRow[]
  } catch (error) {
    if (isMissingTableError(error as { code?: string; message?: string })) {
      return []
    }
    throw formatProcessOutputError(error)
  }
}

async function upsertDailyOutputManual(
  supabase: SupabaseClient,
  filters: Record<string, string>,
  payload: Record<string, unknown>
) {
  let query = supabase.from('process_daily_outputs').select('id').limit(1)
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value)
  }

  const { data: existing, error: selectError } = await query.maybeSingle()
  if (selectError) throw selectError

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('process_daily_outputs')
      .update(payload)
      .eq('id', existing.id)
    if (updateError) throw updateError
    return
  }

  const { error: insertError } = await supabase.from('process_daily_outputs').insert({
    ...filters,
    ...payload,
  })
  if (insertError) throw insertError
}

export async function upsertDailyOutput(
  supabase: SupabaseClient,
  workDate: string,
  targetType: ProcessTargetType,
  targetCode: string,
  completedQty: number,
  receiptSlipNo?: string | null,
  notes?: string | null
) {
  const date = normalizeWorkDate(workDate)
  const normalizedCode = normalizeTargetCode(targetCode)
  const schema = await detectOutputSchema(supabase)
  const payload = {
    completed_qty: completedQty,
    receipt_slip_no: receiptSlipNo?.trim() || null,
    notes: notes || null,
    updated_at: new Date().toISOString(),
  }

  if (schema === 'target') {
    const row = {
      work_date: date,
      target_type: targetType,
      target_code: normalizedCode,
      ...payload,
    }
    const { error } = await supabase
      .from('process_daily_outputs')
      .upsert(row, { onConflict: 'work_date,target_type,target_code' })

    if (!error) return
    if (!isOnConflictConstraintError(error)) throw formatProcessOutputError(error)

    await upsertDailyOutputManual(
      supabase,
      {
        work_date: date,
        target_type: targetType,
        target_code: normalizedCode,
      },
      row
    )
    return
  }

  if (targetType !== 'line') {
    throw new Error(
      'D指令の入庫保存には DB 移行が必要です。migrate-process-management-daily.sql を実行してください。'
    )
  }

  const row = {
    work_date: date,
    line_code: normalizedCode,
    ...payload,
  }
  const { error } = await supabase
    .from('process_daily_outputs')
    .upsert(row, { onConflict: 'work_date,line_code' })

  if (!error) return
  if (!isOnConflictConstraintError(error)) throw formatProcessOutputError(error)

  await upsertDailyOutputManual(
    supabase,
    {
      work_date: date,
      line_code: normalizedCode,
    },
    row
  )
}

async function fetchWorkGroupNames(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('work_group_master')
    .select('work_group_code, work_name')

  if (error) throw error

  return new Map((data || []).map((row) => [row.work_group_code, row.work_name]))
}

function sumLeadTimeSt(minutesByGroup: Map<string, number>, completedQty: number) {
  if (completedQty <= 0) return null
  let totalLead = 0
  for (const minutes of minutesByGroup.values()) {
    totalLead += minutes / completedQty
  }
  return totalLead > 0 ? Math.round(totalLead * 10) / 10 : null
}

async function computeBaselineStByWorkGroup(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  lineId: string | null,
  excludeWorkDate: string
) {
  const outputs = await fetchDailyOutputsBefore(
    supabase,
    targetType,
    targetCode,
    excludeWorkDate
  )
  const dailyAvgByGroup = new Map<string, number[]>()

  for (const output of outputs) {
    if (output.completed_qty <= 0) continue

    const minutesByGroup = await aggregateWorkGroupMinutesOnDate(
      supabase,
      output.work_date,
      targetType,
      targetCode,
      lineId
    )

    for (const [workGroupCode, minutes] of minutesByGroup.entries()) {
      if (minutes <= 0) continue
      const avgSt = minutes / output.completed_qty
      const list = dailyAvgByGroup.get(workGroupCode) || []
      list.push(avgSt)
      dailyAvgByGroup.set(workGroupCode, list)
    }
  }

  const baseline = new Map<string, number>()
  for (const [workGroupCode, values] of dailyAvgByGroup.entries()) {
    if (values.length === 0) continue
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    baseline.set(workGroupCode, Math.round(mean * 10) / 10)
  }

  return baseline
}

export async function analyzeProcessManagement(
  supabase: SupabaseClient,
  workDate: string,
  targetType: ProcessTargetType,
  targetCode: string
): Promise<ProcessAnalysisResult> {
  const date = normalizeWorkDate(workDate)
  const normalizedCode = normalizeTargetCode(targetCode)

  let targetName = normalizedCode
  let lineId: string | null = null

  if (targetType === 'line') {
    const line = await resolveLineId(supabase, normalizedCode)
    if (!line) {
      throw new Error(`ライン ${normalizedCode} が見つかりません`)
    }
    targetName = line.name
    lineId = line.id
  } else {
    const order = await resolveInstruction(supabase, normalizedCode)
    if (!order) {
      throw new Error(`D指令 ${normalizedCode} が見つかりません`)
    }
    targetName = order.product_name || normalizedCode
    if (order.model) {
      targetName = `${targetName}（${order.model}）`
    }
  }

  const workGroupNames = await fetchWorkGroupNames(supabase)
  const dailyOutput = await fetchDailyOutputRow(
    supabase,
    date,
    targetType,
    normalizedCode
  )
  const completedQty = dailyOutput?.completed_qty ?? null
  const receiptSlipNo = dailyOutput?.receipt_slip_no ?? null

  const currentMinutes = await aggregateWorkGroupMinutesOnDate(
    supabase,
    date,
    targetType,
    normalizedCode,
    lineId
  )

  const baselineSt = await computeBaselineStByWorkGroup(
    supabase,
    targetType,
    normalizedCode,
    lineId,
    date
  )

  const allGroupCodes = new Set<string>([
    ...currentMinutes.keys(),
    ...baselineSt.keys(),
  ])

  const rows: ProcessWorkGroupRow[] = []

  for (const workGroupCode of Array.from(allGroupCodes).sort()) {
    const totalMinutes = currentMinutes.get(workGroupCode) || 0
    const avgSt =
      completedQty && completedQty > 0 && totalMinutes > 0
        ? Math.round((totalMinutes / completedQty) * 10) / 10
        : null
    const baseline = baselineSt.get(workGroupCode) ?? null
    let variationPct: number | null = null
    if (avgSt !== null && baseline !== null && baseline > 0) {
      variationPct = Math.round(((avgSt - baseline) / baseline) * 1000) / 10
    }

    rows.push({
      work_group_code: workGroupCode,
      work_group_name: workGroupNames.get(workGroupCode) || workGroupCode,
      total_minutes: totalMinutes,
      avg_st_minutes: avgSt,
      baseline_st_minutes: baseline,
      variation_pct: variationPct,
      is_bottleneck_by_st: false,
      is_bottleneck_by_variation: false,
    })
  }

  const withAvgSt = rows.filter((row) => row.avg_st_minutes !== null)
  const maxAvgSt = withAvgSt.length
    ? Math.max(...withAvgSt.map((row) => row.avg_st_minutes as number))
    : null

  const withVariation = rows.filter(
    (row) => row.variation_pct !== null && (row.avg_st_minutes ?? 0) > 0
  )
  const maxVariation = withVariation.length
    ? Math.max(...withVariation.map((row) => row.variation_pct as number))
    : null

  let bottleneckBySt: string | null = null
  let bottleneckByVariation: string | null = null

  for (const row of rows) {
    if (maxAvgSt !== null && row.avg_st_minutes === maxAvgSt) {
      row.is_bottleneck_by_st = true
      bottleneckBySt = row.work_group_code
    }
    if (maxVariation !== null && row.variation_pct === maxVariation && (row.variation_pct ?? 0) > 0) {
      row.is_bottleneck_by_variation = true
      bottleneckByVariation = row.work_group_code
    }
  }

  const monthOutputs = await fetchDailyOutputsInMonth(
    supabase,
    targetType,
    normalizedCode,
    date
  )
  const monthCompletedQty = monthOutputs.reduce(
    (sum, row) => sum + (row.completed_qty || 0),
    0
  )

  const historyDays: ProcessDayHistory[] = []
  for (const output of monthOutputs) {
    const minutesByGroup = await aggregateWorkGroupMinutesOnDate(
      supabase,
      output.work_date,
      targetType,
      normalizedCode,
      lineId
    )
    historyDays.push({
      work_date: output.work_date,
      completed_qty: output.completed_qty,
      receipt_slip_no: output.receipt_slip_no,
      total_lead_time_st: sumLeadTimeSt(minutesByGroup, output.completed_qty),
    })
  }

  if (!historyDays.some((item) => item.work_date === date)) {
    historyDays.push({
      work_date: date,
      completed_qty: completedQty,
      receipt_slip_no: receiptSlipNo,
      total_lead_time_st:
        completedQty && completedQty > 0
          ? sumLeadTimeSt(currentMinutes, completedQty)
          : null,
    })
    historyDays.sort((a, b) => a.work_date.localeCompare(b.work_date))
  }

  return {
    target_type: targetType,
    target_code: normalizedCode,
    target_name: targetName,
    work_date: date,
    completed_qty: completedQty,
    receipt_slip_no: receiptSlipNo,
    month_completed_qty: monthCompletedQty,
    rows,
    bottleneck_by_st: bottleneckBySt,
    bottleneck_by_variation: bottleneckByVariation,
    history_days: historyDays,
  }
}

export type FiscalYearWorkGroupRow = {
  work_group_code: string
  work_group_name: string
  total_minutes: number
  duration_hours: string
}

export type FiscalYearLineWorkGroupSummary = {
  fiscal_year: number
  fiscal_year_label: string
  period_start: string
  period_end: string
  line_code: string
  line_name: string
  total_minutes: number
  duration_hours: string
  rows: FiscalYearWorkGroupRow[]
}

/** 会計年度（9/1〜翌8/31）のライン別・作業グループ別所要時間 */
export async function aggregateLineWorkGroupMinutesInFiscalYear(
  supabase: SupabaseClient,
  lineCode: string,
  fiscalYear: number
): Promise<FiscalYearLineWorkGroupSummary> {
  if (!Number.isFinite(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    throw new Error('fiscal_year が不正です')
  }

  const normalizedCode = normalizeTargetCode(lineCode)
  const line = await resolveLineId(supabase, normalizedCode)
  if (!line) {
    throw new Error(`ライン ${normalizedCode} が見つかりません`)
  }

  const { start, end } = getFiscalYearDateRange(fiscalYear)
  const totals = await aggregateTargetWorkGroupMinutesInRange(
    supabase,
    'line',
    normalizedCode,
    start,
    end,
    line.id
  )
  const workGroupNames = await fetchWorkGroupNames(supabase)

  const rows: FiscalYearWorkGroupRow[] = Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'ja', { numeric: true }))
    .map(([workGroupCode, totalMinutes]) => ({
      work_group_code: workGroupCode,
      work_group_name: workGroupNames.get(workGroupCode) || workGroupCode,
      total_minutes: totalMinutes,
      duration_hours: formatDurationHours(totalMinutes),
    }))

  const totalMinutes = rows.reduce((sum, row) => sum + row.total_minutes, 0)

  return {
    fiscal_year: fiscalYear,
    fiscal_year_label: formatFiscalYearLabel(fiscalYear),
    period_start: start,
    period_end: end,
    line_code: line.line_code,
    line_name: line.name,
    total_minutes: totalMinutes,
    duration_hours: formatDurationHours(totalMinutes),
    rows,
  }
}

function roundSt(value: number) {
  return Math.round(value * 10) / 10
}

function buildWorkGroupRowsFromMinutes(
  minutesByGroup: Map<string, number>,
  completedQty: number,
  workGroupNames: Map<string, string>,
  baselineSt: Map<string, number>
): ProcessWorkGroupRow[] {
  const rows: ProcessWorkGroupRow[] = []
  const allCodes = new Set<string>([...minutesByGroup.keys(), ...baselineSt.keys()])

  for (const workGroupCode of Array.from(allCodes).sort()) {
    const totalMinutes = minutesByGroup.get(workGroupCode) || 0
    const avgSt =
      completedQty > 0 && totalMinutes > 0 ? roundSt(totalMinutes / completedQty) : null
    const baseline = baselineSt.get(workGroupCode) ?? null
    let variationPct: number | null = null
    if (avgSt !== null && baseline !== null && baseline > 0) {
      variationPct = roundSt(((avgSt - baseline) / baseline) * 100)
    }

    rows.push({
      work_group_code: workGroupCode,
      work_group_name: workGroupNames.get(workGroupCode) || workGroupCode,
      total_minutes: totalMinutes,
      avg_st_minutes: avgSt,
      baseline_st_minutes: baseline,
      variation_pct: variationPct,
      is_bottleneck_by_st: false,
      is_bottleneck_by_variation: false,
    })
  }

  const withAvgSt = rows.filter((row) => row.avg_st_minutes !== null)
  const maxAvgSt = withAvgSt.length
    ? Math.max(...withAvgSt.map((row) => row.avg_st_minutes as number))
    : null
  const withVariation = rows.filter(
    (row) => row.variation_pct !== null && (row.avg_st_minutes ?? 0) > 0
  )
  const maxVariation = withVariation.length
    ? Math.max(...withVariation.map((row) => row.variation_pct as number))
    : null

  for (const row of rows) {
    if (maxAvgSt !== null && row.avg_st_minutes === maxAvgSt) {
      row.is_bottleneck_by_st = true
    }
    if (maxVariation !== null && row.variation_pct === maxVariation && (row.variation_pct ?? 0) > 0) {
      row.is_bottleneck_by_variation = true
    }
  }

  return rows
}

function computeBaselineFromPriorLots(priorLots: ProductionLotAnalysis[]) {
  const valuesByGroup = new Map<string, number[]>()

  for (const lot of priorLots) {
    for (const row of lot.rows) {
      if (row.avg_st_minutes === null || row.avg_st_minutes <= 0) continue
      const list = valuesByGroup.get(row.work_group_code) || []
      list.push(row.avg_st_minutes)
      valuesByGroup.set(row.work_group_code, list)
    }
  }

  const baseline = new Map<string, number>()
  for (const [workGroupCode, values] of valuesByGroup.entries()) {
    if (values.length === 0) continue
    baseline.set(
      workGroupCode,
      roundSt(values.reduce((sum, value) => sum + value, 0) / values.length)
    )
  }
  return baseline
}

async function resolveTargetContext(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string
) {
  const normalizedCode = normalizeTargetCode(targetCode)

  if (targetType === 'line') {
    const line = await resolveLineId(supabase, normalizedCode)
    if (!line) throw new Error(`ライン ${normalizedCode} が見つかりません`)
    return { targetName: line.name, lineId: line.id as string }
  }

  const order = await resolveInstruction(supabase, normalizedCode)
  if (!order) throw new Error(`D指令 ${normalizedCode} が見つかりません`)
  let targetName = order.product_name || normalizedCode
  if (order.model) targetName = `${targetName}（${order.model}）`
  return { targetName, lineId: null as string | null }
}

async function analyzeSingleProductionLot(
  supabase: SupabaseClient,
  lot: ProductionLotRecord,
  lineId: string | null,
  workGroupNames: Map<string, string>,
  priorLots: ProductionLotAnalysis[]
): Promise<ProductionLotAnalysis> {
  const minutesByGroup = await aggregateTargetWorkGroupMinutesInRange(
    supabase,
    lot.target_type,
    lot.target_code,
    lot.period_start,
    lot.period_end,
    lineId
  )
  const baselineSt = computeBaselineFromPriorLots(priorLots)
  const rows = buildWorkGroupRowsFromMinutes(
    minutesByGroup,
    lot.completed_qty,
    workGroupNames,
    baselineSt
  )
  const bottleneckBySt = rows.find((row) => row.is_bottleneck_by_st)?.work_group_code ?? null
  const bottleneckByVariation =
    rows.find((row) => row.is_bottleneck_by_variation)?.work_group_code ?? null

  return {
    lot,
    is_cumulative: false,
    total_lead_time_st: sumLeadTimeSt(minutesByGroup, lot.completed_qty),
    rows,
    bottleneck_by_st: bottleneckBySt,
    bottleneck_by_variation: bottleneckByVariation,
  }
}

export async function listProductionLotRecords(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string
): Promise<ProductionLotRecord[]> {
  const normalizedCode = normalizeTargetCode(targetCode)
  const { data, error } = await supabase
    .from('process_production_lots')
    .select(
      'id, target_type, target_code, period_start, period_end, completed_qty, receipt_slip_no, notes'
    )
    .eq('target_type', targetType)
    .eq('target_code', normalizedCode)
    .order('period_end', { ascending: true })
    .order('period_start', { ascending: true })

  if (error) {
    if (isMissingTableError(error)) {
      throw new Error(
        'process_production_lots テーブルがありません。Supabaseで create-process-production-lots.sql を実行してください。'
      )
    }
    throw error
  }

  return (data || []).map((row) => ({
    id: row.id,
    target_type: row.target_type as ProcessTargetType,
    target_code: row.target_code,
    period_start: String(row.period_start),
    period_end: String(row.period_end),
    completed_qty: row.completed_qty,
    receipt_slip_no: row.receipt_slip_no,
    notes: row.notes,
  }))
}

export async function analyzeProductionLots(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string
): Promise<ProductionLotsResult> {
  const { targetName, lineId } = await resolveTargetContext(supabase, targetType, targetCode)
  const records = await listProductionLotRecords(supabase, targetType, targetCode)
  const workGroupNames = await fetchWorkGroupNames(supabase)

  const lastLot = records.length > 0 ? records[records.length - 1] : null
  const suggestedPeriodStart = lastLot ? shiftCalendarDate(lastLot.period_end, 1) : null

  const lots: ProductionLotAnalysis[] = []
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    const analysis = await analyzeSingleProductionLot(
      supabase,
      record,
      lineId,
      workGroupNames,
      lots
    )
    lots.push({
      ...analysis,
      is_cumulative: index === 0,
    })
  }

  return {
    target_type: targetType,
    target_code: normalizeTargetCode(targetCode),
    target_name: targetName,
    suggested_period_start: suggestedPeriodStart,
    lots,
  }
}

function shiftCalendarDate(dateStr: string, days: number) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function reportHasTargetActivity(
  supabase: SupabaseClient,
  reportId: string,
  targetType: ProcessTargetType,
  targetCode: string,
  lineId: string | null
) {
  let query = supabase
    .from('work_report_items')
    .select('line_id, instruction_text')
    .eq('report_id', reportId)
    .limit(20)

  if (targetType === 'line' && lineId) {
    query = query.eq('line_id', lineId)
  }

  const { data: items, error } = await query
  if (error) throw error
  if (!items?.length) return false

  if (targetType === 'line') {
    return items.some((item) => item.line_id === lineId)
  }

  return items.some((item) => instructionMatchesOrderNo(item.instruction_text, targetCode))
}

/** 製作開始日: 前ロットあり→前回完成日の翌日、なし→累計（最初の作業日） */
export async function resolveProductionLotPeriodStart(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  periodEnd: string,
  lineId: string | null,
  existingLots?: ProductionLotRecord[]
) {
  const end = normalizeWorkDate(periodEnd)
  const normalizedCode = normalizeTargetCode(targetCode)
  const records = existingLots ?? (await listProductionLotRecords(supabase, targetType, normalizedCode))
  const lastLot = records.length > 0 ? records[records.length - 1] : null

  if (lastLot) {
    return shiftCalendarDate(lastLot.period_end, 1)
  }

  const pageSize = 500
  let offset = 0

  while (true) {
    const { data: reports, error } = await supabase
      .from('work_reports')
      .select('id, work_date')
      .lte('work_date', end)
      .eq('is_draft', false)
      .order('work_date', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error

    const batch = reports || []
    if (batch.length === 0) break

    for (const report of batch) {
      const hasActivity = await reportHasTargetActivity(
        supabase,
        report.id,
        targetType,
        normalizedCode,
        lineId
      )
      if (hasActivity) {
        return String(report.work_date)
      }
    }

    if (batch.length < pageSize) break
    offset += pageSize
  }

  throw new Error('完成日以前に該当する作業日報がありません。作業日報のライン／D指令を確認してください。')
}

export async function createProductionLot(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  periodEnd: string,
  completedQty: number,
  receiptSlipNo?: string | null,
  notes?: string | null
) {
  const end = normalizeWorkDate(periodEnd)
  const normalizedCode = normalizeTargetCode(targetCode)

  if (!Number.isFinite(completedQty) || completedQty <= 0) {
    throw new Error('completed_qty は1以上の数値です')
  }

  const { lineId } = await resolveTargetContext(supabase, targetType, normalizedCode)
  const existingLots = await listProductionLotRecords(supabase, targetType, normalizedCode)
  const start = await resolveProductionLotPeriodStart(
    supabase,
    targetType,
    normalizedCode,
    end,
    lineId,
    existingLots
  )

  if (end < start) {
    throw new Error(
      existingLots.length > 0
        ? '完成日は前回完成日の翌日以降を指定してください'
        : '完成日は製作開始日（自動算出）以降を指定してください'
    )
  }

  const { data, error } = await supabase
    .from('process_production_lots')
    .insert({
      target_type: targetType,
      target_code: normalizedCode,
      period_start: start,
      period_end: end,
      completed_qty: completedQty,
      receipt_slip_no: receiptSlipNo?.trim() || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (isMissingTableError(error)) {
      throw new Error(
        'process_production_lots テーブルがありません。Supabaseで create-process-production-lots.sql を実行してください。'
      )
    }
    throw error
  }

  return data.id as string
}

export async function deleteProductionLot(supabase: SupabaseClient, lotId: string) {
  const { error } = await supabase.from('process_production_lots').delete().eq('id', lotId)
  if (error) throw error
}

/** ラインマスタ全件 + D指令マスタ全件 */
export async function listProcessTargets(supabase: SupabaseClient): Promise<ProcessTarget[]> {
  const [linesResult, ordersResult] = await Promise.all([
    supabase
      .from('lines')
      .select('line_code, name, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('line_code', { ascending: true }),
    supabase
      .from('work_orders')
      .select('order_no, product_name, model')
      .order('order_no', { ascending: true }),
  ])

  if (linesResult.error) throw linesResult.error
  if (ordersResult.error) throw ordersResult.error

  const targets: ProcessTarget[] = []

  for (const line of linesResult.data || []) {
    targets.push({
      target_type: 'line',
      target_code: line.line_code,
      name: line.name,
      subtitle: `ライン ${line.line_code}`,
    })
  }

  const seenOrders = new Set<string>()
  for (const order of ordersResult.data || []) {
    const orderNo = normalizeTargetCode(order.order_no || '')
    if (!orderNo || seenOrders.has(orderNo)) continue
    seenOrders.add(orderNo)

    const subtitleParts = [order.product_name, order.model].filter(Boolean)
    targets.push({
      target_type: 'instruction',
      target_code: orderNo,
      name: orderNo,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(' / ') : 'D指令',
    })
  }

  return targets
}
