import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchByIdChunks, fetchWorkReportsInRange } from '@/lib/work-report-query'

export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    if (!from || !to) {
      return NextResponse.json(
        { error: 'from と to が必要です' },
        { status: 400 }
      )
    }

    const reports = await fetchWorkReportsInRange<{ id: string }>(supabase, from, to, 'id')
    const reportIds = reports.map((report) => String(report.id))
    if (reportIds.length === 0) {
      return NextResponse.json([])
    }

    const machineRows = await fetchByIdChunks<{
      report_id: string
      machine: string | null
      confirmed_duration_minutes: number | null
    }>(
      supabase,
      'work_report_machine_durations',
      'report_id, machine, confirmed_duration_minutes',
      'report_id',
      reportIds
    )

    const reportsWithMd = new Set(machineRows.map((row) => String(row.report_id)))
    const aggregation = new Map<string, number>()

    for (const row of machineRows) {
      if (row.machine && String(row.machine).trim()) {
        const key = String(row.machine).trim()
        aggregation.set(key, (aggregation.get(key) || 0) + (row.confirmed_duration_minutes || 0))
      }
    }

    const legacyReportIds = reportIds.filter((id) => !reportsWithMd.has(id))
    if (legacyReportIds.length > 0) {
      const items = await fetchByIdChunks<{ machine: string | null; duration_minutes: number | null }>(
        supabase,
        'work_report_items',
        'machine, duration_minutes',
        'report_id',
        legacyReportIds,
        (query) => query.not('machine', 'is', null)
      )
      for (const item of items) {
        if (item.machine && item.machine.trim()) {
          const key = item.machine.trim()
          aggregation.set(key, (aggregation.get(key) || 0) + (item.duration_minutes || 0))
        }
      }
    }

    const result = Array.from(aggregation.entries()).map(([machine, duration]) => ({
      machine,
      duration_minutes: duration,
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('機械仕様時間集計エラー:', error)
    return NextResponse.json({ error: '機械仕様時間集計に失敗しました' }, { status: 500 })
  }
}
