import type { SupabaseClient } from '@supabase/supabase-js'
import {
  formatDurationHours,
  type MonthlyDurationRow,
} from '@/lib/work-report-aggregation'
import {
  formatFiscalMonthLabel,
  formatFiscalYearLabel,
  getFiscalYear,
  getPreviousFiscalYearSameMonth,
} from '@/lib/fiscal-year'

export type MonthlyCategory = 'line' | 'instruction'

const PAGE_SIZE = 500

export function parseYearMonthFromDate(workDate: string) {
  const match = workDate.match(/^(\d{4})-(\d{2})-/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null
  }
  return { year, month }
}

export function getMonthDateRange(year: number, month: number) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const lastDay = new Date(year, month, 0).getDate()
  return {
    monthStart: `${monthKey}-01`,
    monthEnd: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
    monthKey,
  }
}

type MonthTotals = {
  lines: Map<string, number>
  instructions: Map<string, number>
}

/** 指定暦月の作業日報明細から集計 */
export async function computeMonthTotalsFromSource(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<MonthTotals> {
  const { monthStart, monthEnd } = getMonthDateRange(year, month)

  const { data: reports, error: reportError } = await supabase
    .from('work_reports')
    .select('id')
    .gte('work_date', monthStart)
    .lte('work_date', monthEnd)
    .eq('is_draft', false)

  if (reportError) throw reportError

  const reportIds = (reports || []).map((report) => report.id)
  const lines = new Map<string, number>()
  const instructions = new Map<string, number>()

  if (reportIds.length === 0) {
    return { lines, instructions }
  }

  const { data: allLines, error: lineError } = await supabase
    .from('lines')
    .select('id, line_code')

  if (lineError) throw lineError

  const lineCodeById = new Map((allLines || []).map((line) => [line.id, line.line_code]))

  for (let i = 0; i < reportIds.length; i += 100) {
    const chunkIds = reportIds.slice(i, i + 100)

    let from = 0
    while (true) {
      const { data: items, error: itemError } = await supabase
        .from('work_report_items')
        .select('duration_minutes, line_id, instruction_text, report_id')
        .in('report_id', chunkIds)
        .range(from, from + PAGE_SIZE - 1)

      if (itemError) throw itemError
      const rows = items || []
      if (rows.length === 0) break

      for (const item of rows) {
        const minutes = item.duration_minutes || 0
        if (item.line_id) {
          const lineCode = lineCodeById.get(item.line_id)
          if (lineCode) {
            lines.set(lineCode, (lines.get(lineCode) || 0) + minutes)
          }
        }
        const instruction = (item.instruction_text || '').trim()
        if (instruction) {
          instructions.set(instruction, (instructions.get(instruction) || 0) + minutes)
        }
      }

      if (rows.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }

  return { lines, instructions }
}

/**
 * 月別実績を登録（集計単位は暦月、重複防止は当社年度 9/1〜8/31 基準）
 * - 同じ暦月の再登録: upsert（更新）
 * - 年度が変わる同じ暦月: 前年度分を削除してから登録（例: 26年度の1月登録時に25年度1月を削除）
 */
export async function registerMonthlyDuration(
  supabase: SupabaseClient,
  category: MonthlyCategory,
  code: string,
  year: number,
  month: number,
  durationMinutes: number
) {
  const now = new Date().toISOString()
  const fiscalYear = getFiscalYear(year, month)
  const previous = getPreviousFiscalYearSameMonth(year, month)

  await supabase
    .from('work_report_monthly_durations')
    .delete()
    .eq('category', category)
    .eq('code', code)
    .eq('year', previous.year)
    .eq('month', previous.month)

  if (durationMinutes <= 0) {
    await supabase
      .from('work_report_monthly_durations')
      .delete()
      .eq('category', category)
      .eq('code', code)
      .eq('year', year)
      .eq('month', month)
    return
  }

  const payload: Record<string, unknown> = {
    category,
    code,
    year,
    month,
    duration_minutes: durationMinutes,
    updated_at: now,
    fiscal_year: fiscalYear,
  }

  const { error } = await supabase
    .from('work_report_monthly_durations')
    .upsert(payload, { onConflict: 'category,code,year,month' })

  if (error) throw error
}

/** 指定暦月の全ライン・D指令を作業日報から再集計して登録 */
export async function syncMonthFromWorkReports(
  supabase: SupabaseClient,
  year: number,
  month: number
) {
  const totals = await computeMonthTotalsFromSource(supabase, year, month)

  const touchedLineCodes = new Set(totals.lines.keys())
  const touchedInstructions = new Set(totals.instructions.keys())

  const { data: existingRows, error: existingError } = await supabase
    .from('work_report_monthly_durations')
    .select('category, code')
    .eq('year', year)
    .eq('month', month)

  if (existingError) throw existingError

  for (const row of existingRows || []) {
    if (row.category === 'line') touchedLineCodes.add(row.code)
    if (row.category === 'instruction') touchedInstructions.add(row.code)
  }

  for (const code of touchedLineCodes) {
    await registerMonthlyDuration(
      supabase,
      'line',
      code,
      year,
      month,
      totals.lines.get(code) || 0
    )
  }

  for (const code of touchedInstructions) {
    await registerMonthlyDuration(
      supabase,
      'instruction',
      code,
      year,
      month,
      totals.instructions.get(code) || 0
    )
  }
}

/** 既存の作業日報から月別実績を一括再構築 */
export async function rebuildAllMonthlyDurations(supabase: SupabaseClient) {
  const { data: reports, error } = await supabase
    .from('work_reports')
    .select('work_date')
    .eq('is_draft', false)

  if (error) throw error

  const monthKeys = new Set<string>()
  for (const report of reports || []) {
    const parsed = parseYearMonthFromDate(String(report.work_date))
    if (parsed) {
      monthKeys.add(`${parsed.year}-${parsed.month}`)
    }
  }

  const sorted = Array.from(monthKeys).sort()
  for (const key of sorted) {
    const [year, month] = key.split('-').map(Number)
    await syncMonthFromWorkReports(supabase, year, month)
  }
}

export function rowsToMonthlyDurationList(
  rows: Array<{
    year: number
    month: number
    duration_minutes: number
    fiscal_year?: number | null
  }>
): MonthlyDurationRow[] {
  return rows
    .map((row) => {
      const month = `${row.year}-${String(row.month).padStart(2, '0')}`
      // 表示は常に暦月から年度を算出（DBの fiscal_year が旧定義のまま残っていても正しく表示）
      const fiscalYear = getFiscalYear(row.year, row.month)
      return {
        month,
        month_label: formatFiscalMonthLabel(row.year, row.month),
        fiscal_year: fiscalYear,
        fiscal_year_label: formatFiscalYearLabel(fiscalYear),
        duration_minutes: row.duration_minutes,
        duration_hours: formatDurationHours(row.duration_minutes),
      }
    })
    .sort((a, b) => b.month.localeCompare(a.month))
}

export async function fetchMonthlyDurationsFromStore(
  supabase: SupabaseClient,
  category: MonthlyCategory,
  code?: string
): Promise<Record<string, MonthlyDurationRow[]> | MonthlyDurationRow[]> {
  let query = supabase
    .from('work_report_monthly_durations')
    .select('category, code, year, month, duration_minutes, fiscal_year')
    .eq('category', category)
    .gt('duration_minutes', 0)
    .order('year', { ascending: false })
    .order('month', { ascending: false })

  if (code) {
    query = query.eq('code', code)
  }

  const { data, error } = await query
  if (error) throw error

  if (code) {
    return rowsToMonthlyDurationList(data || [])
  }

  const grouped: Record<string, MonthlyDurationRow[]> = {}
  for (const row of data || []) {
    if (!grouped[row.code]) grouped[row.code] = []
    grouped[row.code].push(
      rowsToMonthlyDurationList([row])[0]
    )
  }

  for (const codeKey of Object.keys(grouped)) {
    grouped[codeKey].sort((a, b) => b.month.localeCompare(a.month))
  }

  return grouped
}

export async function ensureMonthlyStoreInitialized(supabase: SupabaseClient) {
  const { count, error } = await supabase
    .from('work_report_monthly_durations')
    .select('id', { count: 'exact', head: true })

  if (error) {
    if (error.message.includes('does not exist') || error.code === '42P01') {
      return false
    }
    throw error
  }

  if ((count || 0) === 0) {
    await rebuildAllMonthlyDurations(supabase)
  }

  return true
}
