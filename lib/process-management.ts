import type { SupabaseClient } from '@supabase/supabase-js'
import { getMonthDateRange } from '@/lib/work-report-monthly-sync'
import {
  formatFiscalYearLabel,
  getCurrentFiscalYear,
  getFiscalYearDateRange,
  getFiscalYearFromDate,
} from '@/lib/fiscal-year'
import { formatDurationHours } from '@/lib/work-report-aggregation'
import { groupOrdersByHeaterModel } from '@/lib/heater-model-order-match'

export type ProcessTargetType = 'line' | 'instruction' | 'model'

export type ProcessTarget = {
  target_type: ProcessTargetType
  target_code: string
  name: string
  subtitle: string | null
  /** process_production_lots の入庫ロット件数（completed_qty > 0） */
  lot_count?: number
  /** 直近の入庫日（period_end） */
  latest_lot_end?: string | null
  /** 機種の場合: 紐づくD指令件数 */
  linked_order_count?: number
}

export type LinkedInstructionSummary = {
  order_no: string
  product_name: string | null
  annual_completed_qty: number
  total_minutes: number
  /** 班別年平均STの合計（1台あたりリードタイム相当） */
  avg_st_total: number | null
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
  /** UF時: DF基準ST */
  avg_st_df_base_minutes?: number | null
  /** UF時: UF差分ST（実測） */
  avg_st_uf_delta_minutes?: number | null
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
  fiscal_year_summary: FiscalYearWorkGroupSummary | null
  /** 備考（UF/DF）単位の年度平均ST */
  fiscal_year_summaries_by_spec: FiscalYearSpecSummary[]
  /** 機種対象時: 紐づくD指令一覧 */
  linked_instructions?: LinkedInstructionSummary[]
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
  if ((type !== 'line' && type !== 'instruction' && type !== 'model') || !code) {
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

/** 指定期間・対象の「日付×作業グループ」実績時間（分） */
export async function aggregateTargetWorkGroupMinutesByDateInRange(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fromDate: string,
  toDate: string,
  lineId?: string | null
): Promise<Map<string, number>> {
  const start = normalizeWorkDate(fromDate)
  const end = normalizeWorkDate(toDate)
  if (end < start) return new Map()

  const normalizedCode = normalizeTargetCode(targetCode)
  /** key = `${work_date}|${work_group_code}` */
  const totals = new Map<string, number>()
  const pageSize = 500
  let offset = 0

  while (true) {
    const { data: reports, error: reportError } = await supabase
      .from('work_reports')
      .select('id, work_date, staffs(work_group_code)')
      .gte('work_date', start)
      .lte('work_date', end)
      .eq('is_draft', false)
      .order('work_date', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (reportError) throw reportError

    const batch = reports || []
    if (batch.length === 0) break

    const reportMeta = new Map<
      string,
      { work_date: string; staff: ReportStaff }
    >()
    for (const report of batch) {
      reportMeta.set(report.id, {
        work_date: String(report.work_date),
        staff: report as unknown as ReportStaff,
      })
    }
    const reportIds = Array.from(reportMeta.keys())

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
        } else if (lineId && item.line_id !== lineId) {
          continue
        }

        const meta = reportMeta.get(item.report_id)
        if (!meta) continue
        const workGroupCode = item.is_support
          ? item.support_work_group_code
          : getStaffWorkGroupCode(meta.staff)
        if (!workGroupCode) continue

        const key = `${meta.work_date}|${workGroupCode}`
        totals.set(key, (totals.get(key) || 0) + (item.duration_minutes || 0))
      }
    }

    if (batch.length < pageSize) break
    offset += pageSize
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

  if (targetType === 'model') {
    throw new Error(
      '機種単位の日次分析は未対応です。ロット一覧・年間平均STをご確認ください。'
    )
  }

  let targetName = normalizedCode
  let lineId: string | null = null

  if (targetType === 'line') {
    const line = await resolveLineId(supabase, normalizedCode)
    if (!line) {
      throw new Error(`L指令 ${normalizedCode} が見つかりません`)
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
  avg_st_minutes: number | null
  /** UF時: DF基準ST（合計STの内訳） */
  avg_st_df_base_minutes?: number | null
  /** UF時: UF差分ST（合計STの内訳） */
  avg_st_uf_delta_minutes?: number | null
}

export type FiscalYearWorkGroupSummary = {
  fiscal_year: number
  fiscal_year_label: string
  period_start: string
  period_end: string
  target_type: ProcessTargetType
  target_code: string
  target_name: string
  annual_completed_qty: number
  total_minutes: number
  duration_hours: string
  rows: FiscalYearWorkGroupRow[]
  /** 規格キー（UF/DF など）。全体集計は空文字 */
  spec_key?: string
  /** UF合計=DF+UF差分 を適用済みか */
  uf_composed?: boolean
  /** 機種対象時: 紐づくD指令ごとの年平均ST */
  linked_instructions?: LinkedInstructionSummary[]
  /** 機種対象時: 紐づく指令の年平均STを平均した旨 */
  st_aggregation_note?: string | null
}

export type FiscalYearSpecSummary = {
  spec_key: string
  spec_label: string
  summary: FiscalYearWorkGroupSummary
}

/**
 * UF ST = DF ST + UF差分ST
 * DFが工程ベース、UFはDFからの変更に要した時間。
 */
export function composeUfTotalStMap(
  dfSt: Map<string, number>,
  ufDeltaSt: Map<string, number>
): Map<string, number> {
  const result = new Map<string, number>()
  const codes = new Set<string>([...dfSt.keys(), ...ufDeltaSt.keys()])
  for (const code of codes) {
    const total = (dfSt.get(code) || 0) + (ufDeltaSt.get(code) || 0)
    if (total > 0) result.set(code, roundSt(total))
  }
  return result
}

export function stMapFromFiscalRows(rows: FiscalYearWorkGroupRow[]) {
  const map = new Map<string, number>()
  for (const row of rows) {
    if (row.avg_st_minutes !== null && row.avg_st_minutes > 0) {
      map.set(row.work_group_code, row.avg_st_minutes)
    }
  }
  return map
}

/** UFの年度集計に DF+UF差分 の合計STを反映 */
export function applyUfDfCompositionToFiscalBySpec(
  bySpec: FiscalYearSpecSummary[]
): FiscalYearSpecSummary[] {
  const dfSummary = bySpec.find((item) => item.spec_key === 'DF')?.summary
  if (!dfSummary) return bySpec

  const dfMap = stMapFromFiscalRows(dfSummary.rows)

  return bySpec.map((item) => {
    if (item.spec_key !== 'UF') return item
    const ufDeltaMap = stMapFromFiscalRows(item.summary.rows)
    if (dfMap.size === 0) return item

    const nameByCode = new Map(
      item.summary.rows.map((row) => [row.work_group_code, row.work_group_name])
    )
    for (const row of dfSummary.rows) {
      if (!nameByCode.has(row.work_group_code)) {
        nameByCode.set(row.work_group_code, row.work_group_name)
      }
    }

    const composed = composeUfTotalStMap(dfMap, ufDeltaMap)
    const rows: FiscalYearWorkGroupRow[] = Array.from(composed.keys())
      .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }))
      .map((code) => {
        const dfBase = dfMap.get(code) || 0
        const ufDelta = ufDeltaMap.get(code) || 0
        const total = composed.get(code) || 0
        const existing = item.summary.rows.find((row) => row.work_group_code === code)
        return {
          work_group_code: code,
          work_group_name: nameByCode.get(code) || code,
          total_minutes: existing?.total_minutes ?? 0,
          duration_hours: existing?.duration_hours ?? formatDurationHours(0),
          avg_st_minutes: total > 0 ? total : null,
          avg_st_df_base_minutes: dfBase > 0 ? dfBase : null,
          avg_st_uf_delta_minutes: ufDelta > 0 ? ufDelta : null,
        }
      })

    const totalMinutes = rows.reduce((sum, row) => sum + row.total_minutes, 0)
    return {
      ...item,
      spec_label: 'UF（DF+UF差分）',
      summary: {
        ...item.summary,
        rows,
        total_minutes: totalMinutes,
        duration_hours: formatDurationHours(totalMinutes),
        uf_composed: true,
      },
    }
  })
}

/** 備考・機種名から規格キー（UF/DF）を正規化 */
export function normalizeSpecKey(notes: string | null | undefined): string {
  const raw = String(notes || '').trim()
  if (!raw) return ''
  const compact = raw.toUpperCase().replace(/\s+/g, '')
  const hasUf = /(^|[^A-Z0-9])UF([^A-Z0-9]|$)/.test(` ${compact} `) || compact.includes('UF')
  const hasDf = /(^|[^A-Z0-9])DF([^A-Z0-9]|$)/.test(` ${compact} `) || compact.includes('DF')
  if (hasUf && hasDf) {
    // 両方含む場合は先に出現した方
    const ufPos = compact.indexOf('UF')
    const dfPos = compact.indexOf('DF')
    return ufPos >= 0 && (dfPos < 0 || ufPos <= dfPos) ? 'UF' : 'DF'
  }
  if (hasUf) return 'UF'
  if (hasDf) return 'DF'
  return raw
}

export function formatSpecLabel(specKey: string) {
  if (!specKey) return '規格なし'
  if (specKey === 'UF' || specKey === 'DF') return specKey
  return specKey
}

export function lotMatchesSpec(notes: string | null | undefined, specKey: string | null | undefined) {
  const wanted = String(specKey || '').trim()
  if (!wanted) return true
  return normalizeSpecKey(notes) === normalizeSpecKey(wanted)
}

/** @deprecated use FiscalYearWorkGroupSummary */
export type FiscalYearLineWorkGroupSummary = FiscalYearWorkGroupSummary

async function sumFiscalYearCompletedQty(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fiscalYear: number
) {
  const normalizedCode = normalizeTargetCode(targetCode)
  const { start, end } = getFiscalYearDateRange(fiscalYear)

  const { data, error } = await supabase
    .from('process_production_lots')
    .select('completed_qty, period_end')
    .eq('target_type', targetType)
    .eq('target_code', normalizedCode)
    .gte('period_end', start)
    .lte('period_end', end)

  if (error) {
    if (isMissingTableError(error)) return 0
    throw error
  }

  return (data || []).reduce((sum, row) => sum + (row.completed_qty || 0), 0)
}

/** 会計年度（9/1〜翌8/31）の作業グループ別所要時間と平均ST（年間制作台数で割算） */
export async function aggregateTargetWorkGroupSummaryInFiscalYear(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fiscalYear: number
): Promise<FiscalYearWorkGroupSummary> {
  if (!Number.isFinite(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    throw new Error('fiscal_year が不正です')
  }

  const normalizedCode = normalizeTargetCode(targetCode)

  if (targetType === 'model') {
    return aggregateModelWorkGroupSummaryInFiscalYear(
      supabase,
      normalizedCode,
      fiscalYear
    )
  }

  const { targetName, lineId } = await resolveTargetContext(supabase, targetType, normalizedCode)
  const { start, end } = getFiscalYearDateRange(fiscalYear)

  const totals = await aggregateTargetWorkGroupMinutesInRange(
    supabase,
    targetType,
    normalizedCode,
    start,
    end,
    lineId
  )
  const workGroupNames = await fetchWorkGroupNames(supabase)
  const annualCompletedQty = await sumFiscalYearCompletedQty(
    supabase,
    targetType,
    normalizedCode,
    fiscalYear
  )

  const rows: FiscalYearWorkGroupRow[] = Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'ja', { numeric: true }))
    .map(([workGroupCode, totalMinutes]) => ({
      work_group_code: workGroupCode,
      work_group_name: workGroupNames.get(workGroupCode) || workGroupCode,
      total_minutes: totalMinutes,
      duration_hours: formatDurationHours(totalMinutes),
      avg_st_minutes:
        annualCompletedQty > 0 && totalMinutes > 0
          ? roundSt(totalMinutes / annualCompletedQty)
          : null,
    }))

  const totalMinutes = rows.reduce((sum, row) => sum + row.total_minutes, 0)

  return {
    fiscal_year: fiscalYear,
    fiscal_year_label: formatFiscalYearLabel(fiscalYear),
    period_start: start,
    period_end: end,
    target_type: targetType,
    target_code: normalizedCode,
    target_name: targetName,
    annual_completed_qty: annualCompletedQty,
    total_minutes: totalMinutes,
    duration_hours: formatDurationHours(totalMinutes),
    rows,
    spec_key: '',
  }
}

/** 機種: 紐づくD指令それぞれの年平均STを班ごとに平均 */
async function aggregateModelWorkGroupSummaryInFiscalYear(
  supabase: SupabaseClient,
  modelCode: string,
  fiscalYear: number
): Promise<FiscalYearWorkGroupSummary> {
  const { targetName } = await resolveTargetContext(supabase, 'model', modelCode)
  const { start, end } = getFiscalYearDateRange(fiscalYear)
  const linked = await listLinkedInstructionsForModel(supabase, modelCode)
  const workGroupNames = await fetchWorkGroupNames(supabase)

  if (linked.length === 0) {
    return {
      fiscal_year: fiscalYear,
      fiscal_year_label: formatFiscalYearLabel(fiscalYear),
      period_start: start,
      period_end: end,
      target_type: 'model',
      target_code: modelCode,
      target_name: targetName,
      annual_completed_qty: 0,
      total_minutes: 0,
      duration_hours: formatDurationHours(0),
      rows: [],
      spec_key: '',
      linked_instructions: [],
      st_aggregation_note: '紐づくD指令がありません',
    }
  }

  const summaries = await mapPool(linked, 3, async (item) =>
    aggregateTargetWorkGroupSummaryInFiscalYear(
      supabase,
      'instruction',
      item.order_no,
      fiscalYear
    )
  )

  const stSamples = new Map<string, number[]>()
  const minutesByGroup = new Map<string, number>()
  let annualCompletedQty = 0
  let totalMinutes = 0

  const linkedSummaries: LinkedInstructionSummary[] = summaries.map((summary, index) => {
    annualCompletedQty += summary.annual_completed_qty
    totalMinutes += summary.total_minutes
    for (const row of summary.rows) {
      minutesByGroup.set(
        row.work_group_code,
        (minutesByGroup.get(row.work_group_code) || 0) + row.total_minutes
      )
      if (row.avg_st_minutes != null && row.avg_st_minutes > 0) {
        const list = stSamples.get(row.work_group_code) || []
        list.push(row.avg_st_minutes)
        stSamples.set(row.work_group_code, list)
      }
    }
    const avgStTotal = summary.rows
      .map((r) => r.avg_st_minutes)
      .filter((v): v is number => v != null && v > 0)
      .reduce((sum, v) => sum + v, 0)
    return {
      order_no: linked[index].order_no,
      product_name: linked[index].product_name,
      annual_completed_qty: summary.annual_completed_qty,
      total_minutes: summary.total_minutes,
      avg_st_total: avgStTotal > 0 ? roundSt(avgStTotal) : null,
    }
  })

  const allCodes = new Set<string>([...minutesByGroup.keys(), ...stSamples.keys()])
  const rows: FiscalYearWorkGroupRow[] = Array.from(allCodes)
    .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }))
    .map((workGroupCode) => {
      const samples = stSamples.get(workGroupCode) || []
      const avgSt =
        samples.length > 0
          ? roundSt(samples.reduce((sum, v) => sum + v, 0) / samples.length)
          : null
      const groupMinutes = minutesByGroup.get(workGroupCode) || 0
      return {
        work_group_code: workGroupCode,
        work_group_name: workGroupNames.get(workGroupCode) || workGroupCode,
        total_minutes: groupMinutes,
        duration_hours: formatDurationHours(groupMinutes),
        avg_st_minutes: avgSt,
      }
    })

  const withSt = linkedSummaries.filter((item) => item.avg_st_total != null).length

  return {
    fiscal_year: fiscalYear,
    fiscal_year_label: formatFiscalYearLabel(fiscalYear),
    period_start: start,
    period_end: end,
    target_type: 'model',
    target_code: modelCode,
    target_name: targetName,
    annual_completed_qty: annualCompletedQty,
    total_minutes: totalMinutes,
    duration_hours: formatDurationHours(totalMinutes),
    rows,
    spec_key: '',
    linked_instructions: linkedSummaries,
    st_aggregation_note: `関連D指令 ${linked.length}件のうち年平均STあり ${withSt}件の平均値`,
  }
}

/**
 * 会計年度の作業グループ別平均STを備考（UF/DF）単位で算出。
 * 同一製作期間の複数規格ロットは台数比で実績を按分する。
 */
export async function aggregateTargetWorkGroupSummariesBySpecInFiscalYear(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fiscalYear: number
): Promise<{ overall: FiscalYearWorkGroupSummary; by_spec: FiscalYearSpecSummary[] }> {
  if (!Number.isFinite(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    throw new Error('fiscal_year が不正です')
  }

  const normalizedCode = normalizeTargetCode(targetCode)

  if (targetType === 'model') {
    const overall = await aggregateModelWorkGroupSummaryInFiscalYear(
      supabase,
      normalizedCode,
      fiscalYear
    )
    return { overall, by_spec: [] }
  }

  const { targetName, lineId } = await resolveTargetContext(supabase, targetType, normalizedCode)
  const { start, end } = getFiscalYearDateRange(fiscalYear)
  const records = await listProductionLotRecords(supabase, targetType, normalizedCode)
  const fyLots = records.filter((lot) => lot.period_end >= start && lot.period_end <= end)
  const workGroupNames = await fetchWorkGroupNames(supabase)

  const periodQtyTotals = new Map<string, number>()
  for (const lot of fyLots) {
    const key = `${lot.period_start}|${lot.period_end}`
    periodQtyTotals.set(key, (periodQtyTotals.get(key) || 0) + lot.completed_qty)
  }

  const uniquePeriods = Array.from(periodQtyTotals.keys())
  const periodMinutes = new Map<string, Map<string, number>>()
  for (const periodKey of uniquePeriods) {
    const [periodStart, periodEnd] = periodKey.split('|')
    const minutes = await aggregateTargetWorkGroupMinutesInRange(
      supabase,
      targetType,
      normalizedCode,
      periodStart,
      periodEnd,
      lineId
    )
    periodMinutes.set(periodKey, minutes)
  }

  type Acc = { qty: number; minutes: Map<string, number> }
  const bySpec = new Map<string, Acc>()
  const overallAcc: Acc = { qty: 0, minutes: new Map() }

  const addMinutes = (acc: Acc, group: string, value: number) => {
    acc.minutes.set(group, (acc.minutes.get(group) || 0) + value)
  }

  for (const lot of fyLots) {
    const periodKey = `${lot.period_start}|${lot.period_end}`
    const periodTotalQty = periodQtyTotals.get(periodKey) || lot.completed_qty
    const share = periodTotalQty > 0 ? lot.completed_qty / periodTotalQty : 1
    const minutesMap = periodMinutes.get(periodKey) || new Map<string, number>()
    const specKey = normalizeSpecKey(lot.notes)
    const specAcc = bySpec.get(specKey) || { qty: 0, minutes: new Map() }

    for (const [group, minutes] of minutesMap) {
      const allocated = minutes * share
      addMinutes(specAcc, group, allocated)
      addMinutes(overallAcc, group, allocated)
    }
    specAcc.qty += lot.completed_qty
    overallAcc.qty += lot.completed_qty
    bySpec.set(specKey, specAcc)
  }

  const toSummary = (specKey: string, acc: Acc): FiscalYearWorkGroupSummary => {
    const rows: FiscalYearWorkGroupRow[] = Array.from(acc.minutes.entries())
      .filter(([, minutes]) => minutes > 0)
      .sort(([a], [b]) => a.localeCompare(b, 'ja', { numeric: true }))
      .map(([workGroupCode, totalMinutes]) => ({
        work_group_code: workGroupCode,
        work_group_name: workGroupNames.get(workGroupCode) || workGroupCode,
        total_minutes: totalMinutes,
        duration_hours: formatDurationHours(totalMinutes),
        avg_st_minutes:
          acc.qty > 0 && totalMinutes > 0 ? roundSt(totalMinutes / acc.qty) : null,
      }))
    const totalMinutes = rows.reduce((sum, row) => sum + row.total_minutes, 0)
    return {
      fiscal_year: fiscalYear,
      fiscal_year_label: formatFiscalYearLabel(fiscalYear),
      period_start: start,
      period_end: end,
      target_type: targetType,
      target_code: normalizedCode,
      target_name: targetName,
      annual_completed_qty: acc.qty,
      total_minutes: totalMinutes,
      duration_hours: formatDurationHours(totalMinutes),
      rows,
      spec_key: specKey,
    }
  }

  const overall = toSummary('', overallAcc)
  const by_spec = applyUfDfCompositionToFiscalBySpec(
    Array.from(bySpec.entries())
      .map(([specKey, acc]) => ({
        spec_key: specKey,
        spec_label: formatSpecLabel(specKey),
        summary: toSummary(specKey, acc),
      }))
      .sort((a, b) => {
        const order = (key: string) => (key === 'UF' ? 0 : key === 'DF' ? 1 : key === '' ? 9 : 5)
        return order(a.spec_key) - order(b.spec_key) || a.spec_label.localeCompare(b.spec_label, 'ja')
      })
  )

  return { overall, by_spec }
}

/** 規格指定の年度平均STマップ（スケジュール用） */
export async function getFiscalYearAverageStByWorkGroupForSpec(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fiscalYear: number,
  specKey: string | null | undefined
) {
  const wanted = normalizeSpecKey(specKey)
  const { by_spec, overall } = await aggregateTargetWorkGroupSummariesBySpecInFiscalYear(
    supabase,
    targetType,
    targetCode,
    fiscalYear
  )
  const matched = wanted
    ? by_spec.find((item) => item.spec_key === wanted)?.summary
    : overall
  const summary = matched || overall
  const map = new Map<string, number>()
  for (const row of summary.rows) {
    if (row.avg_st_minutes !== null && row.avg_st_minutes > 0) {
      map.set(row.work_group_code, row.avg_st_minutes)
    }
  }
  return { map, summary, spec_key: summary.spec_key || wanted || '' }
}

/** 会計年度の作業グループ別平均ST（比較用） */
export async function getFiscalYearAverageStByWorkGroup(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fiscalYear: number
) {
  const summary = await aggregateTargetWorkGroupSummaryInFiscalYear(
    supabase,
    targetType,
    targetCode,
    fiscalYear
  )
  const map = new Map<string, number>()
  for (const row of summary.rows) {
    if (row.avg_st_minutes !== null && row.avg_st_minutes > 0) {
      map.set(row.work_group_code, row.avg_st_minutes)
    }
  }
  return map
}

/** 会計年度（9/1〜翌8/31）のライン別・作業グループ別所要時間 */
export async function aggregateLineWorkGroupMinutesInFiscalYear(
  supabase: SupabaseClient,
  lineCode: string,
  fiscalYear: number
): Promise<FiscalYearWorkGroupSummary> {
  return aggregateTargetWorkGroupSummaryInFiscalYear(
    supabase,
    'line',
    lineCode,
    fiscalYear
  )
}

function roundSt(value: number) {
  return Math.round(value * 10) / 10
}

function buildWorkGroupRowsFromMinutes(
  minutesByGroup: Map<string, number>,
  completedQty: number,
  workGroupNames: Map<string, string>,
  baselineSt: Map<string, number>,
  options?: {
    dfBaseSt?: Map<string, number>
  }
): ProcessWorkGroupRow[] {
  const rows: ProcessWorkGroupRow[] = []
  const dfBaseSt = options?.dfBaseSt
  const measuredSt = new Map<string, number>()
  for (const [code, minutes] of minutesByGroup) {
    if (completedQty > 0 && minutes > 0) {
      measuredSt.set(code, roundSt(minutes / completedQty))
    }
  }

  const displaySt =
    dfBaseSt && dfBaseSt.size > 0
      ? composeUfTotalStMap(dfBaseSt, measuredSt)
      : measuredSt

  const allCodes = new Set<string>([
    ...displaySt.keys(),
    ...baselineSt.keys(),
    ...(dfBaseSt ? dfBaseSt.keys() : []),
  ])

  for (const workGroupCode of Array.from(allCodes).sort()) {
    const totalMinutes = minutesByGroup.get(workGroupCode) || 0
    const ufDelta = measuredSt.get(workGroupCode) ?? null
    const dfBase = dfBaseSt?.get(workGroupCode) ?? null
    const avgSt = displaySt.get(workGroupCode) ?? null
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
      avg_st_df_base_minutes: dfBase != null && dfBase > 0 ? dfBase : null,
      avg_st_uf_delta_minutes: ufDelta != null && ufDelta > 0 ? ufDelta : null,
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
    if (
      maxVariation !== null &&
      row.variation_pct === maxVariation &&
      (row.variation_pct ?? 0) > 0
    ) {
      row.is_bottleneck_by_variation = true
    }
  }

  return rows
}

export async function resolveTargetContext(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string
) {
  const normalizedCode = normalizeTargetCode(targetCode)

  if (targetType === 'line') {
    const line = await resolveLineId(supabase, normalizedCode)
    if (!line) throw new Error(`L指令 ${normalizedCode} が見つかりません`)
    return { targetName: line.name, lineId: line.id as string }
  }

  if (targetType === 'model') {
    const { data, error } = await supabase
      .from('heater_models')
      .select('model, name')
      .eq('model', normalizedCode)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error(`機種 ${normalizedCode} が見つかりません`)
    const name = String(data.name || '').trim()
    return {
      targetName: name ? `${normalizedCode}（${name}）` : normalizedCode,
      lineId: null as string | null,
    }
  }

  const order = await resolveInstruction(supabase, normalizedCode)
  if (!order) throw new Error(`D指令 ${normalizedCode} が見つかりません`)
  let targetName = order.product_name || normalizedCode
  if (order.model) targetName = `${targetName}（${order.model}）`
  return { targetName, lineId: null as string | null }
}

/** 機種に紐づくD指令一覧（機種別制作指令と同じマッチング） */
export async function listLinkedInstructionsForModel(
  supabase: SupabaseClient,
  modelCode: string
): Promise<Array<{ order_no: string; product_name: string | null; qty: number | null }>> {
  const model = normalizeTargetCode(modelCode)
  const [{ data: models, error: modelError }, { data: orders, error: orderError }] =
    await Promise.all([
      supabase.from('heater_models').select('model, name').order('model', { ascending: true }),
      supabase
        .from('work_orders')
        .select('order_no, product_name, model, bom_model, heater_model, qty')
        .order('order_no', { ascending: true }),
    ])
  if (modelError) throw modelError
  if (orderError) {
    // heater_model 列が無い場合のフォールバック
    if (String(orderError.message || '').includes('heater_model')) {
      const fallback = await supabase
        .from('work_orders')
        .select('order_no, product_name, model, bom_model, qty')
        .order('order_no', { ascending: true })
      if (fallback.error) throw fallback.error
      const heaterRefs = (models || []).map((m) => ({
        model: String(m.model),
        name: m.name ?? null,
      }))
      const { byModel } = groupOrdersByHeaterModel(
        (fallback.data || []).map((o) => ({ ...o, heater_model: null })),
        heaterRefs
      )
      return (byModel.get(model) || []).map((o) => ({
        order_no: normalizeTargetCode(String(o.order_no || '')),
        product_name: o.product_name ?? null,
        qty: o.qty == null ? null : Number(o.qty),
      })).filter((o) => o.order_no)
    }
    throw orderError
  }

  const heaterRefs = (models || []).map((m) => ({
    model: String(m.model),
    name: m.name ?? null,
  }))
  const { byModel } = groupOrdersByHeaterModel(orders || [], heaterRefs)
  return (byModel.get(model) || [])
    .map((o) => ({
      order_no: normalizeTargetCode(String(o.order_no || '')),
      product_name: o.product_name ?? null,
      qty: o.qty == null ? null : Number(o.qty),
    }))
    .filter((o) => o.order_no)
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) || 1 }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

export async function listProductionLotRecords(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string
): Promise<ProductionLotRecord[]> {
  const normalizedCode = normalizeTargetCode(targetCode)

  if (targetType === 'model') {
    const linked = await listLinkedInstructionsForModel(supabase, normalizedCode)
    const batches = await mapPool(linked, 4, async (item) =>
      listProductionLotRecords(supabase, 'instruction', item.order_no)
    )
    return batches
      .flat()
      .sort((a, b) => {
        const end = a.period_end.localeCompare(b.period_end)
        if (end !== 0) return end
        return a.period_start.localeCompare(b.period_start)
      })
  }

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
  const fiscalAvgStCache = new Map<string, Map<string, number>>()
  const fiscalSummaryCache = new Map<number, FiscalYearWorkGroupSummary>()
  const fiscalBySpecCache = new Map<number, FiscalYearSpecSummary[]>()

  const ensureFiscalBaseline = async (fiscalYear: number, specKey = '') => {
    const cacheKey = `${fiscalYear}::${specKey}`
    if (fiscalAvgStCache.has(cacheKey)) {
      return fiscalAvgStCache.get(cacheKey) || new Map<string, number>()
    }
    const { overall, by_spec } = await aggregateTargetWorkGroupSummariesBySpecInFiscalYear(
      supabase,
      targetType,
      targetCode,
      fiscalYear
    )
    fiscalSummaryCache.set(fiscalYear, overall)
    fiscalBySpecCache.set(fiscalYear, by_spec)

    const fillMap = (summary: FiscalYearWorkGroupSummary, key: string) => {
      const map = new Map<string, number>()
      for (const row of summary.rows) {
        if (row.avg_st_minutes !== null && row.avg_st_minutes > 0) {
          map.set(row.work_group_code, row.avg_st_minutes)
        }
      }
      fiscalAvgStCache.set(key, map)
      return map
    }

    fillMap(overall, `${fiscalYear}::`)
    for (const item of by_spec) {
      fillMap(item.summary, `${fiscalYear}::${item.spec_key}`)
    }

    return fiscalAvgStCache.get(cacheKey) || new Map<string, number>()
  }

  const lastLot = records.length > 0 ? records[records.length - 1] : null
  const suggestedPeriodStart = lastLot ? shiftCalendarDate(lastLot.period_end, 1) : null
  const displayFiscalYear =
    (lastLot ? getFiscalYearFromDate(lastLot.period_end) : null) ?? null

  if (displayFiscalYear !== null) {
    try {
      await ensureFiscalBaseline(displayFiscalYear)
    } catch {
      // 年度比較が取れなくてもロット集計自体は継続
    }
  }

  const periodQtyTotals = new Map<string, number>()
  for (const record of records) {
    const key = `${record.period_start}|${record.period_end}`
    periodQtyTotals.set(key, (periodQtyTotals.get(key) || 0) + record.completed_qty)
  }

  const analyzed = await mapPool(records, 3, async (record, index) => {
    const minutesByGroup = await aggregateTargetWorkGroupMinutesInRange(
      supabase,
      record.target_type,
      record.target_code,
      record.period_start,
      record.period_end,
      lineId
    )

    // 同期間の複数ロット（同日UF/DFなど）は実績時間を台数比で按分
    const periodKey = `${record.period_start}|${record.period_end}`
    const periodTotalQty = periodQtyTotals.get(periodKey) || record.completed_qty
    const share =
      periodTotalQty > 0 ? record.completed_qty / periodTotalQty : 1
    const allocatedMinutes = new Map<string, number>()
    for (const [group, minutes] of minutesByGroup) {
      allocatedMinutes.set(group, minutes * share)
    }

    const fiscalYear = getFiscalYearFromDate(record.period_end)
    const specKey = normalizeSpecKey(record.notes)
    let baselineSt = new Map<string, number>()
    let dfBaseSt: Map<string, number> | undefined
    if (fiscalYear !== null) {
      try {
        // UFの比較基準は DF+UF差分 の合計ST
        baselineSt = await ensureFiscalBaseline(fiscalYear, specKey)
      } catch {
        baselineSt = new Map()
      }
      if (specKey === 'UF') {
        try {
          dfBaseSt = await ensureFiscalBaseline(fiscalYear, 'DF')
        } catch {
          dfBaseSt = new Map()
        }
      }
    }
    const rows = buildWorkGroupRowsFromMinutes(
      allocatedMinutes,
      record.completed_qty,
      workGroupNames,
      baselineSt,
      specKey === 'UF' && dfBaseSt && dfBaseSt.size > 0 ? { dfBaseSt } : undefined
    )
    const totalLead =
      specKey === 'UF' && dfBaseSt && dfBaseSt.size > 0
        ? Array.from(
            composeUfTotalStMap(
              dfBaseSt,
              new Map(
                Array.from(allocatedMinutes.entries())
                  .filter(([, minutes]) => record.completed_qty > 0 && minutes > 0)
                  .map(([code, minutes]) => [
                    code,
                    roundSt(minutes / record.completed_qty),
                  ])
              )
            ).values()
          ).reduce((sum, st) => sum + st, 0)
        : sumLeadTimeSt(allocatedMinutes, record.completed_qty)

    return {
      lot: record,
      is_cumulative: index === 0,
      total_lead_time_st: totalLead != null && totalLead > 0 ? roundSt(totalLead) : null,
      rows,
      bottleneck_by_st: rows.find((row) => row.is_bottleneck_by_st)?.work_group_code ?? null,
      bottleneck_by_variation:
        rows.find((row) => row.is_bottleneck_by_variation)?.work_group_code ?? null,
    } satisfies ProductionLotAnalysis
  })

  let fiscalYearSummary: FiscalYearWorkGroupSummary | null = null
  let fiscalYearSummariesBySpec: FiscalYearSpecSummary[] = []
  if (displayFiscalYear !== null) {
    fiscalYearSummary = fiscalSummaryCache.get(displayFiscalYear) ?? null
    fiscalYearSummariesBySpec = fiscalBySpecCache.get(displayFiscalYear) ?? []
    if (!fiscalYearSummary) {
      try {
        const { overall, by_spec } = await aggregateTargetWorkGroupSummariesBySpecInFiscalYear(
          supabase,
          targetType,
          targetCode,
          displayFiscalYear
        )
        fiscalYearSummary = overall
        fiscalYearSummariesBySpec = by_spec
      } catch {
        fiscalYearSummary = null
        fiscalYearSummariesBySpec = []
      }
    }
  }

  return {
    target_type: targetType,
    target_code: normalizeTargetCode(targetCode),
    target_name: targetName,
    suggested_period_start: suggestedPeriodStart,
    lots: analyzed,
    fiscal_year_summary: fiscalYearSummary,
    fiscal_year_summaries_by_spec: fiscalYearSummariesBySpec,
    linked_instructions: fiscalYearSummary?.linked_instructions,
  }
}

function shiftCalendarDate(dateStr: string, days: number) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 完成日以前で最初に該当する作業日を探す（最古ロットの製作開始日） */
async function resolveFirstActivityDate(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  periodEnd: string,
  lineId: string | null
) {
  const end = normalizeWorkDate(periodEnd)
  const normalizedCode = normalizeTargetCode(targetCode)
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

    const reportDateById = new Map(batch.map((report) => [report.id, String(report.work_date)]))
    const reportIds = batch.map((report) => report.id)

    for (let i = 0; i < reportIds.length; i += 100) {
      const chunkIds = reportIds.slice(i, i + 100)
      let query = supabase
        .from('work_report_items')
        .select('report_id, line_id, instruction_text')
        .in('report_id', chunkIds)

      if (targetType === 'line' && lineId) {
        query = query.eq('line_id', lineId)
      }

      const { data: items, error: itemError } = await query
      if (itemError) throw itemError

      let earliestDate: string | null = null
      for (const item of items || []) {
        const matched =
          targetType === 'line'
            ? item.line_id === lineId
            : instructionMatchesOrderNo(item.instruction_text, normalizedCode)
        if (!matched) continue
        const workDate = reportDateById.get(item.report_id)
        if (!workDate) continue
        if (!earliestDate || workDate < earliestDate) earliestDate = workDate
      }
      if (earliestDate) return earliestDate
    }

    if (batch.length < pageSize) break
    offset += pageSize
  }

  throw new Error('完成日以前に該当する作業日報がありません。作業日報のL指令／D指令を確認してください。')
}

/**
 * 完成日順に製作期間を算出する。
 * 同日ロットは期間を共有し、前後ロットは完成日+1でつなぐ（さかのぼり登録可）。
 */
async function computePeriodStartsByEnd(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  lineId: string | null,
  periodEnds: string[]
): Promise<Map<string, string>> {
  const uniqueEnds = Array.from(
    new Set(periodEnds.map((value) => normalizeWorkDate(value)))
  ).sort((a, b) => a.localeCompare(b))

  const startsByEnd = new Map<string, string>()
  if (uniqueEnds.length === 0) return startsByEnd

  for (let i = 0; i < uniqueEnds.length; i++) {
    const end = uniqueEnds[i]
    const start =
      i === 0
        ? await resolveFirstActivityDate(supabase, targetType, targetCode, end, lineId)
        : shiftCalendarDate(uniqueEnds[i - 1], 1)

    if (end < start) {
      throw new Error(
        i === 0
          ? '完成日は製作開始日（自動算出）以降を指定してください'
          : `完成日 ${end} は直前ロット完成日の翌日以降になるよう期間を組めません`
      )
    }
    startsByEnd.set(end, start)
  }

  return startsByEnd
}

/** 対象の全ロットの period_start を完成日順に再接続する */
async function syncProductionLotPeriodStarts(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  lineId: string | null,
  lots: ProductionLotRecord[]
) {
  const startsByEnd = await computePeriodStartsByEnd(
    supabase,
    targetType,
    targetCode,
    lineId,
    lots.map((lot) => lot.period_end)
  )

  const updates = lots.filter((lot) => lot.period_start !== startsByEnd.get(lot.period_end))
  await Promise.all(
    updates.map(async (lot) => {
      const periodStart = startsByEnd.get(lot.period_end)
      if (!periodStart) return
      const { error } = await supabase
        .from('process_production_lots')
        .update({
          period_start: periodStart,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lot.id)
      if (error) throw error
    })
  )
}

/** 製作開始日: さかのぼり可。前後ロットの完成日順で期間を決める */
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
  const startsByEnd = await computePeriodStartsByEnd(
    supabase,
    targetType,
    normalizedCode,
    lineId,
    [...records.map((lot) => lot.period_end), end]
  )
  const start = startsByEnd.get(end)
  if (!start) {
    throw new Error('製作開始日の算出に失敗しました')
  }
  return start
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
  if (targetType === 'model') {
    throw new Error(
      '機種単位では入庫登録できません。関連のD指令を選択して入庫登録してください。'
    )
  }

  const end = normalizeWorkDate(periodEnd)
  const normalizedCode = normalizeTargetCode(targetCode)

  if (!Number.isFinite(completedQty) || completedQty <= 0) {
    throw new Error('completed_qty は1以上の数値です')
  }

  const { lineId } = await resolveTargetContext(supabase, targetType, normalizedCode)
  const existingLots = await listProductionLotRecords(supabase, targetType, normalizedCode)
  const startsByEnd = await computePeriodStartsByEnd(
    supabase,
    targetType,
    normalizedCode,
    lineId,
    [...existingLots.map((lot) => lot.period_end), end]
  )
  const start = startsByEnd.get(end)
  if (!start) {
    throw new Error('製作開始日の算出に失敗しました')
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

  // さかのぼり登録時、前後ロットの製作開始日をつなぎ直す
  const outdatedLots = existingLots.filter(
    (lot) => lot.period_start !== startsByEnd.get(lot.period_end)
  )
  await Promise.all(
    outdatedLots.map(async (lot) => {
      const periodStart = startsByEnd.get(lot.period_end)
      if (!periodStart) return
      const { error: updateError } = await supabase
        .from('process_production_lots')
        .update({
          period_start: periodStart,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lot.id)
      if (updateError) throw updateError
    })
  )

  // D指令入庫: 期間実績から制作工賃を自動確定し、現サイクル時間をリセット
  let assemblyLabor: {
    assembly_labor_minutes: number
    assembly_labor_cost: number
    labor_receipt_date: string | null
  } | null = null
  if (targetType === 'instruction') {
    try {
      const minutesByGroup = await aggregateTargetWorkGroupMinutesInRange(
        supabase,
        targetType,
        normalizedCode,
        start,
        end,
        lineId
      )
      let periodTotalMinutes = 0
      for (const value of minutesByGroup.values()) {
        periodTotalMinutes += Number(value) || 0
      }
      const { applyInstructionReceiptLaborResetWithQty } = await import(
        '@/lib/work-order-assembly-labor'
      )
      assemblyLabor = await applyInstructionReceiptLaborResetWithQty(
        supabase,
        normalizedCode,
        end,
        periodTotalMinutes,
        completedQty
      )
    } catch (laborError) {
      console.warn('制作工賃の入庫リセットに失敗（ロット自体は保存済み）:', laborError)
    }
  }

  return {
    lot_id: data.id as string,
    period_start: start,
    period_end: end,
    assembly_labor: assemblyLabor,
  }
}

export async function deleteProductionLot(supabase: SupabaseClient, lotId: string) {
  const { data: lot, error: fetchError } = await supabase
    .from('process_production_lots')
    .select('id, target_type, target_code')
    .eq('id', lotId)
    .maybeSingle()

  if (fetchError) throw fetchError
  if (!lot) throw new Error('削除対象のロットが見つかりません')

  const { error } = await supabase.from('process_production_lots').delete().eq('id', lotId)
  if (error) throw error

  const targetType = lot.target_type as ProcessTargetType
  const targetCode = normalizeTargetCode(lot.target_code)
  const { lineId } = await resolveTargetContext(supabase, targetType, targetCode)
  const remaining = await listProductionLotRecords(supabase, targetType, targetCode)
  if (remaining.length > 0) {
    await syncProductionLotPeriodStarts(supabase, targetType, targetCode, lineId, remaining)
  }
}

export type ProcessScheduleStSource = {
  target_type: ProcessTargetType
  target_code: string
  /** 適用対象機種（必須） */
  model: string
  fiscal_year: number
  /** '' = 全体 */
  spec_key: string
  apply_to_schedule: boolean
  updated_at: string | null
}

function normalizeScheduleSpecKey(specKey: string | null | undefined): string {
  if (!specKey || specKey === '__ALL__') return ''
  return normalizeSpecKey(specKey) || String(specKey).trim()
}

function normalizeScheduleModel(model: string | null | undefined): string {
  return String(model || '').trim()
}

function formatProcessScheduleStSourcesTableError(error: { message?: string; code?: string }) {
  if (
    error.code === '42P01' ||
    error.message?.includes('process_schedule_st_sources') ||
    error.message?.includes('schema cache')
  ) {
    return new Error(
      'process_schedule_st_sources テーブルがありません。Supabaseで create-process-schedule-st-sources.sql を実行してください。'
    )
  }
  if (error.message?.includes('model') && error.message?.includes('column')) {
    return new Error(
      'process_schedule_st_sources に model 列がありません。create-process-schedule-st-sources.sql の移行SQLを実行してください。'
    )
  }
  return error instanceof Error ? error : new Error(String(error.message || error))
}

function mapScheduleStSourceRow(row: {
  target_type: string
  target_code: string
  model?: string | null
  fiscal_year: number
  spec_key?: string | null
  apply_to_schedule?: boolean
  updated_at?: string | null
}): ProcessScheduleStSource {
  const targetType: ProcessTargetType =
    row.target_type === 'instruction'
      ? 'instruction'
      : row.target_type === 'model'
        ? 'model'
        : 'line'
  return {
    target_type: targetType,
    target_code: String(row.target_code),
    model: normalizeScheduleModel(row.model),
    fiscal_year: Number(row.fiscal_year),
    spec_key: normalizeScheduleSpecKey(row.spec_key),
    apply_to_schedule: row.apply_to_schedule !== false,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  }
}

/** 指令に紐づくスケジュール適用指定一覧 */
export async function listProcessScheduleStSources(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string
): Promise<ProcessScheduleStSource[]> {
  const normalized = normalizeTargetCode(targetCode)
  const { data, error } = await supabase
    .from('process_schedule_st_sources')
    .select('target_type, target_code, model, fiscal_year, spec_key, apply_to_schedule, updated_at')
    .eq('target_type', targetType)
    .eq('target_code', normalized)
    .eq('apply_to_schedule', true)
    .order('model', { ascending: true })

  if (error) {
    if (
      error.code === '42P01' ||
      error.message?.includes('process_schedule_st_sources') ||
      error.message?.includes('schema cache')
    ) {
      return []
    }
    throw error
  }

  return (data || [])
    .map(mapScheduleStSourceRow)
    .filter((row) => row.model.length > 0)
}

/** 機種に紐づくスケジュール適用指定一覧（指令横断） */
export async function listProcessScheduleStSourcesByModel(
  supabase: SupabaseClient,
  model: string
): Promise<ProcessScheduleStSource[]> {
  const modelKey = normalizeScheduleModel(model)
  if (!modelKey) return []

  const { data, error } = await supabase
    .from('process_schedule_st_sources')
    .select('target_type, target_code, model, fiscal_year, spec_key, apply_to_schedule, updated_at')
    .eq('model', modelKey)
    .eq('apply_to_schedule', true)
    .order('updated_at', { ascending: false })

  if (error) {
    if (
      error.code === '42P01' ||
      error.message?.includes('process_schedule_st_sources') ||
      error.message?.includes('schema cache')
    ) {
      return []
    }
    throw formatProcessScheduleStSourcesTableError(error)
  }

  return (data || [])
    .map(mapScheduleStSourceRow)
    .filter((row) => row.model.length > 0)
}

export async function getProcessScheduleStSource(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  model?: string | null
): Promise<ProcessScheduleStSource | null> {
  const normalized = normalizeTargetCode(targetCode)
  const modelKey = normalizeScheduleModel(model)

  let query = supabase
    .from('process_schedule_st_sources')
    .select('target_type, target_code, model, fiscal_year, spec_key, apply_to_schedule, updated_at')
    .eq('target_type', targetType)
    .eq('target_code', normalized)
    .eq('apply_to_schedule', true)

  if (modelKey) {
    query = query.eq('model', modelKey)
  }

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (
      error.code === '42P01' ||
      error.message?.includes('process_schedule_st_sources') ||
      error.message?.includes('schema cache')
    ) {
      return null
    }
    throw error
  }
  if (!data) return null
  const mapped = mapScheduleStSourceRow(data)
  if (!mapped.model) return null
  return mapped
}

/** 工程管理の年平均STをスケジュール適用ON/OFF（機種必須） */
export async function setProcessScheduleStSource(
  supabase: SupabaseClient,
  input: {
    target_type: ProcessTargetType
    target_code: string
    model: string
    fiscal_year: number
    spec_key?: string | null
    apply_to_schedule: boolean
  }
): Promise<ProcessScheduleStSource | null> {
  const targetType = input.target_type
  const targetCode = normalizeTargetCode(input.target_code)
  const model = normalizeScheduleModel(input.model)
  const fiscalYear = Number(input.fiscal_year)
  const specKey = normalizeScheduleSpecKey(input.spec_key)

  if (!targetCode) throw new Error('target_code が必要です')
  if (!model) throw new Error('適用する機種を指定してください')
  if (!Number.isFinite(fiscalYear)) throw new Error('fiscal_year が不正です')

  if (!input.apply_to_schedule) {
    const { error } = await supabase
      .from('process_schedule_st_sources')
      .delete()
      .eq('target_type', targetType)
      .eq('target_code', targetCode)
      .eq('model', model)
    if (error) throw formatProcessScheduleStSourcesTableError(error)
    return null
  }

  const now = new Date().toISOString()
  const payload = {
    target_type: targetType,
    target_code: targetCode,
    model,
    fiscal_year: fiscalYear,
    spec_key: specKey,
    apply_to_schedule: true,
    updated_at: now,
  }
  const { data, error } = await supabase
    .from('process_schedule_st_sources')
    .upsert(payload, { onConflict: 'target_type,target_code,model' })
    .select('target_type, target_code, model, fiscal_year, spec_key, apply_to_schedule, updated_at')
    .maybeSingle()

  if (error) throw formatProcessScheduleStSourcesTableError(error)

  const source = mapScheduleStSourceRow(data || payload)

  // 適用時は指令マスタの標準時間も年平均ST合計で更新
  await syncTargetStandardDurationFromFiscalAverage(supabase, targetType, targetCode, {
    fiscalYear,
    specKey,
    model,
  })

  return source
}

/** 班別年平均STマップの合計（指令標準時間として採用） */
export function sumFiscalAverageStMinutes(map: Map<string, number>): number {
  let sum = 0
  for (const value of map.values()) {
    if (Number.isFinite(value) && value > 0) sum += value
  }
  return sum > 0 ? Math.round(sum) : 0
}

/**
 * 指令の標準時間を解決する。
 * 優先: 工程管理の年平均ST合計（適用指定の年度・規格があればそれ）→ マスタ標準時間
 */
export async function resolveTargetStandardDurationMinutes(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  options?: {
    fiscalYear?: number
    specKey?: string | null
    model?: string | null
  }
): Promise<{
  minutes: number
  source: 'fiscal' | 'master' | 'none'
  fiscal_year: number | null
  spec_key: string
  note: string | null
}> {
  const normalized = normalizeTargetCode(targetCode)
  let fiscalYear = options?.fiscalYear
  let specKey =
    options?.specKey === undefined ? undefined : normalizeScheduleSpecKey(options.specKey)

  if (fiscalYear == null || specKey === undefined) {
    let applied = options?.model
      ? await getProcessScheduleStSource(supabase, targetType, normalized, options.model)
      : null
    if (!applied) {
      const sources = await listProcessScheduleStSources(supabase, targetType, normalized)
      applied =
        [...sources].sort((a, b) =>
          String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
        )[0] || null
    }
    if (applied) {
      if (fiscalYear == null) fiscalYear = applied.fiscal_year
      if (specKey === undefined) specKey = applied.spec_key
    }
  }

  if (fiscalYear == null) fiscalYear = getCurrentFiscalYear()
  if (specKey === undefined) specKey = ''

  const { map } = await getFiscalYearAverageStByWorkGroupForSpec(
    supabase,
    targetType,
    normalized,
    fiscalYear,
    specKey || null
  )
  const fiscalMinutes = sumFiscalAverageStMinutes(map)
  if (fiscalMinutes > 0) {
    return {
      minutes: fiscalMinutes,
      source: 'fiscal',
      fiscal_year: fiscalYear,
      spec_key: specKey,
      note: `工程管理 ${formatFiscalYearLabel(fiscalYear)}平均ST合計${
        specKey ? ` / ${specKey}` : ' / 全体'
      }`,
    }
  }

  if (targetType === 'line') {
    const { data, error } = await supabase
      .from('lines')
      .select('standard_duration_minutes')
      .eq('line_code', normalized)
      .maybeSingle()
    if (error) throw error
    const minutes = Math.max(0, Math.round(Number(data?.standard_duration_minutes || 0)))
    return {
      minutes,
      source: minutes > 0 ? 'master' : 'none',
      fiscal_year: null,
      spec_key: '',
      note: minutes > 0 ? 'L指令マスタの標準時間' : null,
    }
  }

  if (targetType === 'model') {
    return {
      minutes: 0,
      source: 'none',
      fiscal_year: null,
      spec_key: '',
      note: '機種単位の標準時間マスタはありません（関連D指令の平均STを利用）',
    }
  }

  const { data, error } = await supabase
    .from('work_orders')
    .select('standard_duration_minutes')
    .eq('order_no', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const minutes = Math.max(0, Math.round(Number(data?.standard_duration_minutes || 0)))
  return {
    minutes,
    source: minutes > 0 ? 'master' : 'none',
    fiscal_year: null,
    spec_key: '',
    note: minutes > 0 ? 'D指令マスタの標準時間' : null,
  }
}

/** 年平均ST合計を指令マスタの standard_duration_minutes へ反映 */
export async function syncTargetStandardDurationFromFiscalAverage(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  options?: {
    fiscalYear?: number
    specKey?: string | null
    model?: string | null
  }
): Promise<{
  updated: boolean
  minutes: number
  source: 'fiscal' | 'master' | 'none'
  note: string | null
}> {
  const normalized = normalizeTargetCode(targetCode)
  const resolved = await resolveTargetStandardDurationMinutes(
    supabase,
    targetType,
    normalized,
    options
  )

  if (resolved.source !== 'fiscal' || resolved.minutes <= 0) {
    return {
      updated: false,
      minutes: resolved.minutes,
      source: resolved.source,
      note: resolved.note,
    }
  }

  if (targetType === 'model') {
    return {
      updated: false,
      minutes: resolved.minutes,
      source: resolved.source,
      note: '機種単位では指令マスタ標準時間の更新をスキップします',
    }
  }

  const now = new Date().toISOString()
  if (targetType === 'line') {
    const { error } = await supabase
      .from('lines')
      .update({
        standard_duration_minutes: resolved.minutes,
        updated_at: now,
      })
      .eq('line_code', normalized)
    if (error) throw error
  } else {
    const { calcAssemblyLaborFromMinutes } = await import('@/lib/work-order-assembly-labor')
    const labor = calcAssemblyLaborFromMinutes(resolved.minutes)
    const { error } = await supabase
      .from('work_orders')
      .update({
        standard_duration_minutes: resolved.minutes,
        assembly_labor_minutes: labor.assembly_labor_minutes,
        assembly_labor_cost: labor.assembly_labor_cost,
        updated_at: now,
      })
      .eq('order_no', normalized)
    if (error) {
      // 制作工賃列未追加環境では標準時間のみ更新
      if (String(error.message || '').includes('assembly_labor')) {
        const { error: fallbackError } = await supabase
          .from('work_orders')
          .update({
            standard_duration_minutes: resolved.minutes,
            updated_at: now,
          })
          .eq('order_no', normalized)
        if (fallbackError) throw fallbackError
      } else {
        throw error
      }
    }
  }

  return {
    updated: true,
    minutes: resolved.minutes,
    source: 'fiscal',
    note: resolved.note,
  }
}

/** 指令に紐づく機種候補（D: work_orders / L: heater_models / 機種: 自身） */
export async function listModelsForProcessTarget(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string
): Promise<Array<{ model: string; label: string }>> {
  const normalized = normalizeTargetCode(targetCode)
  const models = new Map<string, string>()

  if (targetType === 'model') {
    const { data, error } = await supabase
      .from('heater_models')
      .select('model, name')
      .eq('model', normalized)
      .maybeSingle()
    if (error) throw error
    if (data) {
      const key = normalizeScheduleModel(data.model)
      if (key) {
        models.set(key, data.name ? `${key} / ${data.name}` : key)
      }
    }
    return Array.from(models.entries())
      .map(([model, label]) => ({ model, label }))
      .sort((a, b) => a.model.localeCompare(b.model, 'ja'))
  }

  if (targetType === 'instruction') {
    const { data, error } = await supabase
      .from('work_orders')
      .select('order_no, model, bom_model, product_name')
      .eq('order_no', normalized)
    if (error) throw error
    for (const row of data || []) {
      for (const candidate of [row.model, row.bom_model, row.order_no]) {
        const key = normalizeScheduleModel(candidate)
        if (!key) continue
        const labelParts = [key]
        if (row.product_name) labelParts.push(String(row.product_name))
        if (!models.has(key)) models.set(key, labelParts.join(' / '))
      }
    }
  } else {
    const { data, error } = await supabase
      .from('heater_models')
      .select('model, name')
      .order('model', { ascending: true })
    if (error) throw error
    for (const row of data || []) {
      const key = normalizeScheduleModel(row.model)
      if (!key) continue
      models.set(key, row.name ? `${key} / ${row.name}` : key)
    }
  }

  return Array.from(models.entries())
    .map(([model, label]) => ({ model, label }))
    .sort((a, b) => a.model.localeCompare(b.model, 'ja'))
}

/** 入庫ロットがある対象の件数・直近完成日を集計 */
export async function listProductionLotStatsByTarget(
  supabase: SupabaseClient
): Promise<
  Map<string, { lot_count: number; latest_lot_end: string | null; completed_qty_total: number }>
> {
  const stats = new Map<
    string,
    { lot_count: number; latest_lot_end: string | null; completed_qty_total: number }
  >()

  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('process_production_lots')
      .select('target_type, target_code, period_end, completed_qty')
      .gt('completed_qty', 0)
      .range(from, from + pageSize - 1)

    if (error) {
      if (error.code === '42P01' || error.message?.includes('process_production_lots')) {
        return stats
      }
      throw error
    }

    const rows = data || []
    for (const row of rows) {
      const targetType = row.target_type === 'instruction' ? 'instruction' : 'line'
      const targetCode = normalizeTargetCode(String(row.target_code || ''))
      if (!targetCode) continue
      const key = `${targetType}:${targetCode}`
      const periodEnd = String(row.period_end || '')
      const qty = Number(row.completed_qty) || 0
      const current = stats.get(key) || {
        lot_count: 0,
        latest_lot_end: null as string | null,
        completed_qty_total: 0,
      }
      current.lot_count += 1
      current.completed_qty_total += qty
      if (!current.latest_lot_end || periodEnd > current.latest_lot_end) {
        current.latest_lot_end = periodEnd || current.latest_lot_end
      }
      stats.set(key, current)
    }

    if (rows.length < pageSize) break
    from += pageSize
  }

  return stats
}

/** ラインマスタ全件 + D指令マスタ全件 + 機種マスタ（関連D指令あり） */
export async function listProcessTargets(supabase: SupabaseClient): Promise<ProcessTarget[]> {
  const [linesResult, ordersResult, modelsResult, lotStats] = await Promise.all([
    supabase
      .from('lines')
      .select('line_code, name, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('line_code', { ascending: true }),
    supabase
      .from('work_orders')
      .select('order_no, product_name, model, bom_model, heater_model, qty')
      .order('order_no', { ascending: true }),
    supabase
      .from('heater_models')
      .select('model, name')
      .order('model', { ascending: true }),
    listProductionLotStatsByTarget(supabase),
  ])

  if (linesResult.error) throw linesResult.error
  if (modelsResult.error) throw modelsResult.error

  let orderRows = ordersResult.data || []
  if (ordersResult.error) {
    if (String(ordersResult.error.message || '').includes('heater_model')) {
      const fallback = await supabase
        .from('work_orders')
        .select('order_no, product_name, model, bom_model, qty')
        .order('order_no', { ascending: true })
      if (fallback.error) throw fallback.error
      orderRows = (fallback.data || []).map((o) => ({ ...o, heater_model: null }))
    } else {
      throw ordersResult.error
    }
  }

  const targets: ProcessTarget[] = []

  for (const line of linesResult.data || []) {
    const target_code = String(line.line_code)
    const stats = lotStats.get(`line:${normalizeTargetCode(target_code)}`)
    targets.push({
      target_type: 'line',
      target_code,
      name: line.name,
      subtitle: `L指令 ${target_code}`,
      lot_count: stats?.lot_count || 0,
      latest_lot_end: stats?.latest_lot_end || null,
    })
  }

  const seenOrders = new Map<
    string,
    { product_name: string | null; models: Set<string> }
  >()
  for (const order of orderRows) {
    const orderNo = normalizeTargetCode(order.order_no || '')
    if (!orderNo) continue
    const current = seenOrders.get(orderNo) || {
      product_name: null,
      models: new Set<string>(),
    }
    if (!current.product_name && order.product_name) {
      current.product_name = order.product_name
    }
    const model = String(order.model || '').trim()
    if (model) current.models.add(model)
    seenOrders.set(orderNo, current)
  }

  for (const [orderNo, info] of seenOrders) {
    const modelList = Array.from(info.models).sort((a, b) => a.localeCompare(b, 'ja'))
    const subtitleParts = [
      info.product_name,
      modelList.length > 0 ? `規格: ${modelList.join(' / ')}` : null,
    ].filter(Boolean)
    const stats = lotStats.get(`instruction:${orderNo}`)
    targets.push({
      target_type: 'instruction',
      target_code: orderNo,
      name: orderNo,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(' / ') : 'D指令',
      lot_count: stats?.lot_count || 0,
      latest_lot_end: stats?.latest_lot_end || null,
    })
  }

  const heaterRefs = (modelsResult.data || []).map((m) => ({
    model: String(m.model),
    name: m.name ?? null,
  }))
  const { byModel } = groupOrdersByHeaterModel(orderRows, heaterRefs)

  for (const modelRow of modelsResult.data || []) {
    const model = String(modelRow.model || '').trim()
    if (!model) continue
    const linked = byModel.get(model) || []
    if (linked.length === 0) continue

    let lotCount = 0
    let latestLotEnd: string | null = null
    for (const order of linked) {
      const orderNo = normalizeTargetCode(String(order.order_no || ''))
      if (!orderNo) continue
      const stats = lotStats.get(`instruction:${orderNo}`)
      if (!stats) continue
      lotCount += stats.lot_count
      if (
        stats.latest_lot_end &&
        (!latestLotEnd || stats.latest_lot_end > latestLotEnd)
      ) {
        latestLotEnd = stats.latest_lot_end
      }
    }

    targets.push({
      target_type: 'model',
      target_code: model,
      name: String(modelRow.name || model),
      subtitle: `関連D指令 ${linked.length}件`,
      lot_count: lotCount,
      latest_lot_end: latestLotEnd,
      linked_order_count: linked.length,
    })
  }

  return targets
}
