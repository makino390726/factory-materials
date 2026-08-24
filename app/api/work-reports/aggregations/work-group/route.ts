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

    type ReportRow = {
      id: string
      work_date: string
      staff_id: string
      staffs: { work_group_code?: string | null } | null
    }
    const reports = await fetchWorkReportsInRange<ReportRow>(
      supabase,
      from,
      to,
      'id, work_date, staff_id, staffs(work_group_code)'
    )
    const reportIds = reports.map((report) => String(report.id))

    type ItemRow = {
      report_id: string
      is_support?: boolean
      support_work_group_code?: string | null
      work_type?: string
      work_content?: string
      duration_minutes: number | null
    }
    const itemsData = await fetchByIdChunks<ItemRow>(
      supabase,
      'work_report_items',
      'report_id, is_support, support_work_group_code, work_type, work_content, duration_minutes',
      'report_id',
      reportIds
    )

    const { data: workGroups, error: groupError } = await supabase
      .from('work_group_master')
      .select('work_group_code, work_name')

    if (groupError) {
      console.error('Supabaseエラー:', groupError)
      return NextResponse.json({ error: groupError.message }, { status: 500 })
    }

    const workGroupMap = new Map(
      (workGroups || []).map((group) => [group.work_group_code, group.work_name])
    )

    const groupTotals = new Map<
      string,
      { work_group_code: string; work_group_name: string; total_minutes: number }
    >()

    const itemsByReport = new Map<string, ItemRow[]>()
    for (const item of itemsData) {
      const key = String(item.report_id)
      const list = itemsByReport.get(key) || []
      list.push(item)
      itemsByReport.set(key, list)
    }

    for (const report of reports) {
      const staffWorkGroupCode = report.staffs?.work_group_code
      const reportItems = itemsByReport.get(String(report.id)) || []

      for (const item of reportItems) {
        const actualWorkGroupCode = item.is_support
          ? item.support_work_group_code
          : staffWorkGroupCode

        if (!actualWorkGroupCode) continue

        const existing = groupTotals.get(actualWorkGroupCode) || {
          work_group_code: actualWorkGroupCode,
          work_group_name: workGroupMap.get(actualWorkGroupCode) || actualWorkGroupCode,
          total_minutes: 0,
        }

        existing.total_minutes += item.duration_minutes || 0
        groupTotals.set(actualWorkGroupCode, existing)
      }
    }

    const result = Array.from(groupTotals.values()).sort((a, b) =>
      a.work_group_code.localeCompare(b.work_group_code)
    )

    return NextResponse.json(result)
  } catch (error) {
    console.error('作業グループ別集計エラー:', error)
    return NextResponse.json({ error: '作業グループ別集計に失敗しました' }, { status: 500 })
  }
}
