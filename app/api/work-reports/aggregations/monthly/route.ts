import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { formatDurationHours, type MonthlyDurationRow } from '@/lib/work-report-aggregation'
import {
  computeMonthTotalsFromSource,
  ensureMonthlyStoreInitialized,
  fetchMonthlyDurationsFromStore,
  rebuildAllMonthlyDurations,
  rowsToMonthlyDurationList,
  syncMonthFromWorkReports,
} from '@/lib/work-report-monthly-sync'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function liveAggregateAllLines(): Promise<Record<string, MonthlyDurationRow[]>> {
  const { data: reports, error } = await supabase
    .from('work_reports')
    .select('work_date')
    .eq('is_draft', false)

  if (error) throw error

  const monthKeys = new Set<string>()
  for (const report of reports || []) {
    const date = String(report.work_date)
    const key = date.slice(0, 7)
    if (key.length === 7) monthKeys.add(key)
  }

  const result: Record<string, MonthlyDurationRow[]> = {}

  for (const monthKey of Array.from(monthKeys).sort()) {
    const [year, month] = monthKey.split('-').map(Number)
    const totals = await computeMonthTotalsFromSource(supabase, year, month)
    for (const [lineCode, minutes] of totals.lines.entries()) {
      if (!result[lineCode]) result[lineCode] = []
      const row = rowsToMonthlyDurationList([{ year, month, duration_minutes: minutes }])[0]
      const existing = result[lineCode].find((item) => item.month === row.month)
      if (existing) {
        existing.duration_minutes += minutes
        existing.duration_hours = formatDurationHours(existing.duration_minutes)
      } else {
        result[lineCode].push(row)
      }
    }
  }

  for (const code of Object.keys(result)) {
    result[code].sort((a, b) => b.month.localeCompare(a.month))
  }

  return result
}

async function liveAggregateSingleLine(lineCode: string): Promise<MonthlyDurationRow[]> {
  const { data: line, error: lineError } = await supabase
    .from('lines')
    .select('id')
    .eq('line_code', lineCode)
    .maybeSingle()

  if (lineError) throw lineError
  if (!line) return []

  const { data: reports, error } = await supabase
    .from('work_reports')
    .select('work_date')
    .eq('is_draft', false)

  if (error) throw error

  const monthKeys = new Set<string>()
  for (const report of reports || []) {
    const key = String(report.work_date).slice(0, 7)
    if (key.length === 7) monthKeys.add(key)
  }

  const rows: Array<{ year: number; month: number; duration_minutes: number }> = []

  for (const monthKey of monthKeys) {
    const [year, month] = monthKey.split('-').map(Number)
    const totals = await computeMonthTotalsFromSource(supabase, year, month)
    const minutes = totals.lines.get(lineCode) || 0
    if (minutes > 0) {
      rows.push({ year, month, duration_minutes: minutes })
    }
  }

  return rowsToMonthlyDurationList(rows)
}

async function readFromStore(
  category: 'line' | 'instruction',
  code?: string,
  all?: boolean
) {
  await ensureMonthlyStoreInitialized(supabase)

  if (all || !code) {
    return fetchMonthlyDurationsFromStore(supabase, category)
  }

  const rows = await fetchMonthlyDurationsFromStore(supabase, category, code)
  return Array.isArray(rows) ? rows : []
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const code = searchParams.get('code')?.trim()
    const all = searchParams.get('all') === '1' || !code
    const rebuild = searchParams.get('rebuild') === '1'

    if (!category) {
      return NextResponse.json({ error: 'category が必要です' }, { status: 400 })
    }

    if (rebuild) {
      await rebuildAllMonthlyDurations(supabase)
    }

    try {
      if (category === 'line') {
        if (all) {
          return NextResponse.json(await readFromStore('line', undefined, true))
        }
        if (!code) {
          return NextResponse.json({ error: 'code が必要です' }, { status: 400 })
        }
        return NextResponse.json(await readFromStore('line', code))
      }

      if (category === 'instruction') {
        if (all) {
          return NextResponse.json(await readFromStore('instruction', undefined, true))
        }
        if (!code) {
          return NextResponse.json({ error: 'code が必要です' }, { status: 400 })
        }
        return NextResponse.json(await readFromStore('instruction', code))
      }

      return NextResponse.json({ error: 'category は line または instruction です' }, { status: 400 })
    } catch (storeError) {
      console.warn('月別ストア読み込み失敗、作業日報から直接集計します:', storeError)

      if (category === 'line') {
        if (all) {
          return NextResponse.json(await liveAggregateAllLines())
        }
        if (!code) {
          return NextResponse.json({ error: 'code が必要です' }, { status: 400 })
        }
        return NextResponse.json(await liveAggregateSingleLine(code))
      }

      throw storeError
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '月別集計に失敗しました'
    console.error('月別集計エラー:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** 指定月を作業日報から再集計して登録（管理用） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const year = Number(body?.year)
    const month = Number(body?.month)

    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'year, month が必要です' }, { status: 400 })
    }

    await syncMonthFromWorkReports(supabase, year, month)

    return NextResponse.json({ success: true, year, month })
  } catch (error) {
    const message = error instanceof Error ? error.message : '月別登録に失敗しました'
    console.error('月別登録エラー:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
