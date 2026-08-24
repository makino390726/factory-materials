import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isDirectWorkType, isIndirectWorkType } from '@/lib/work-report-item-validation'

export const runtime = 'nodejs'

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

    const { data: reports, error } = await supabase
      .from('work_reports')
      .select('id, work_date, work_minutes, staff:staff_id (id, name, department, login_id)')
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date', { ascending: true })

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const reportList = reports || []
    const reportIds = reportList.map((report) => report.id)

    let itemMap = new Map<string, { direct: number; indirect: number }>()
    if (reportIds.length > 0) {
      const { data: items, error: itemError } = await supabase
        .from('work_report_items')
        .select('report_id, work_type, duration_minutes')
        .in('report_id', reportIds)

      if (itemError) {
        console.error('Supabaseエラー:', itemError)
        return NextResponse.json({ error: itemError.message }, { status: 500 })
      }

      itemMap = new Map()
      for (const item of items || []) {
        const key = String(item.report_id)
        const entry = itemMap.get(key) || { direct: 0, indirect: 0 }
        const minutes = Number(item.duration_minutes || 0)
        if (isDirectWorkType(item.work_type)) entry.direct += minutes
        else if (isIndirectWorkType(item.work_type)) entry.indirect += minutes
        itemMap.set(key, entry)
      }
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
