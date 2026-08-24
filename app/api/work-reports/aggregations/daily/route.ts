import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isDirectWorkType, isIndirectWorkType } from '@/lib/work-report-item-validation'
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

    const reportList = await fetchWorkReportsInRange<{ id: string; work_date: string }>(
      supabase,
      from,
      to,
      'id, work_date'
    )
    const dateByReportId = new Map(reportList.map((report) => [String(report.id), String(report.work_date)]))
    const itemsData = await fetchByIdChunks<{
      report_id: string
      work_type: string
      duration_minutes: number | null
    }>(
      supabase,
      'work_report_items',
      'report_id, work_type, duration_minutes',
      'report_id',
      reportList.map((report) => String(report.id))
    )

    const byDate = new Map<string, { work_date: string; direct_minutes: number; indirect_minutes: number }>()
    for (const item of itemsData) {
      const workDate = dateByReportId.get(String(item.report_id))
      if (!workDate) continue
      const row = byDate.get(workDate) || { work_date: workDate, direct_minutes: 0, indirect_minutes: 0 }
      const minutes = Number(item.duration_minutes || 0)
      if (isDirectWorkType(item.work_type)) row.direct_minutes += minutes
      else if (isIndirectWorkType(item.work_type)) row.indirect_minutes += minutes
      byDate.set(workDate, row)
    }

    const result = Array.from(byDate.values()).sort((a, b) => a.work_date.localeCompare(b.work_date))

    return NextResponse.json(result)
  } catch (error) {
    console.error('日別集計エラー:', error)
    return NextResponse.json({ error: '日別集計に失敗しました' }, { status: 500 })
  }
}
