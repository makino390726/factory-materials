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

    type ReportRow = {
      id: string
      work_date: string
      work_minutes: number
      staff: { id: string; name: string; department?: string | null; login_id: string } | null
    }
    const reportList = await fetchWorkReportsInRange<ReportRow>(
      supabase,
      from,
      to,
      'id, work_date, work_minutes, staff:staff_id (id, name, department, login_id)'
    )

    const items = await fetchByIdChunks<{
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

    const itemMap = new Map<string, { direct: number; indirect: number }>()
    for (const item of items) {
      const key = String(item.report_id)
      const entry = itemMap.get(key) || { direct: 0, indirect: 0 }
      const minutes = Number(item.duration_minutes || 0)
      if (isDirectWorkType(item.work_type)) entry.direct += minutes
      else if (isIndirectWorkType(item.work_type)) entry.indirect += minutes
      itemMap.set(key, entry)
    }

    const summary = reportList.map((report) => {
      const totals = itemMap.get(String(report.id)) || { direct: 0, indirect: 0 }
      return {
        report_id: report.id,
        work_date: report.work_date,
        work_minutes: report.work_minutes,
        direct_minutes: totals.direct,
        indirect_minutes: totals.indirect,
        staff: report.staff,
      }
    })

    return NextResponse.json(summary)
  } catch (error) {
    console.error('集約取得エラー:', error)
    return NextResponse.json({ error: '集約取得に失敗しました' }, { status: 500 })
  }
}
