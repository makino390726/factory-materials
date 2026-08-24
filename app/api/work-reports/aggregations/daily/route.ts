import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isDirectWorkType, isIndirectWorkType } from '@/lib/work-report-item-validation'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ItemRow = { report_id: string; work_type: string; duration_minutes: number | null }

async function fetchItemsForReports(reportIds: string[]): Promise<ItemRow[]> {
  const items: ItemRow[] = []
  const idChunkSize = 100
  for (let i = 0; i < reportIds.length; i += idChunkSize) {
    const ids = reportIds.slice(i, i + idChunkSize)
    let offset = 0
    const pageSize = 1000
    while (true) {
      const { data, error } = await supabase
        .from('work_report_items')
        .select('report_id, work_type, duration_minutes')
        .in('report_id', ids)
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (error) throw new Error(error.message)
      const rows = (data || []) as ItemRow[]
      items.push(...rows)
      if (rows.length < pageSize) break
      offset += pageSize
    }
  }
  return items
}

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

    const { data: reports, error } = await supabase
      .from('work_reports')
      .select('id, work_date')
      .gte('work_date', from)
      .lte('work_date', to)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const reportList = reports || []
    const dateByReportId = new Map(reportList.map((report) => [String(report.id), String(report.work_date)]))
    const itemsData = reportList.length > 0
      ? await fetchItemsForReports(reportList.map((report) => String(report.id)))
      : []

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
