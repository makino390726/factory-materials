import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentFiscalYear, getFiscalYearDateRange } from '@/lib/fiscal-year'
import { fetchByIdChunks } from '@/lib/work-report-query'

const PAGE_SIZE = 1000

export type LineAccumulation = {
  duration_minutes: number
  completed_qty: number
}

type ConfirmedReportRow = { id: string }
type AccumulationItemRow = {
  line_id: string | null
  duration_minutes: number | null
  completed_qty?: number | null
}

async function fetchConfirmedReportIds(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const ids: string[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('work_reports')
      .select('id')
      .eq('is_draft', false)
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    const rows = (data || []) as ConfirmedReportRow[]
    ids.push(...rows.map((row) => row.id))
    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return ids
}

/** 確定日報から、指定会計年度の L指令ごとの制作時間・完成個数を集計する */
export async function fetchLineAccumulations(
  supabase: SupabaseClient,
  fiscalYear = getCurrentFiscalYear()
): Promise<Map<string, LineAccumulation>> {
  const totals = new Map<string, LineAccumulation>()
  const { start, end } = getFiscalYearDateRange(fiscalYear)
  const reportIds = await fetchConfirmedReportIds(supabase, start, end)
  if (reportIds.length === 0) return totals

  let items: AccumulationItemRow[]
  try {
    items = await fetchByIdChunks<AccumulationItemRow>(
      supabase,
      'work_report_items',
      'line_id, duration_minutes, completed_qty',
      'report_id',
      reportIds
    )
  } catch (itemError) {
    const message = itemError instanceof Error ? itemError.message : ''
    if (!message.includes('completed_qty')) throw itemError
    items = await fetchByIdChunks<AccumulationItemRow>(
      supabase,
      'work_report_items',
      'line_id, duration_minutes',
      'report_id',
      reportIds
    )
  }

  for (const item of items) {
    if (!item.line_id) continue
    const current = totals.get(item.line_id) || { duration_minutes: 0, completed_qty: 0 }
    current.duration_minutes += item.duration_minutes || 0
    current.completed_qty += item.completed_qty || 0
    totals.set(item.line_id, current)
  }

  return totals
}
