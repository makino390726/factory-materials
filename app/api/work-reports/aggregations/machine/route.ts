import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
      .select('id')
      .gte('work_date', from)
      .lte('work_date', to)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const reportIds = (reports || []).map((report) => report.id)
    if (reportIds.length === 0) {
      return NextResponse.json([])
    }

    const { data: machineRows, error: mdError } = await supabase
      .from('work_report_machine_durations')
      .select('report_id, machine, confirmed_duration_minutes')
      .in('report_id', reportIds)

    if (mdError) {
      console.error('Supabaseエラー:', mdError)
      return NextResponse.json({ error: mdError.message }, { status: 500 })
    }

    const reportsWithMd = new Set((machineRows || []).map((row) => row.report_id))
    const aggregation = new Map<string, number>()

    for (const row of machineRows || []) {
      if (row.machine && String(row.machine).trim()) {
        const key = String(row.machine).trim()
        const current = aggregation.get(key) || 0
        aggregation.set(key, current + (row.confirmed_duration_minutes || 0))
      }
    }

    const legacyReportIds = reportIds.filter((id) => !reportsWithMd.has(id))

    if (legacyReportIds.length > 0) {
      const { data: items, error: itemError } = await supabase
        .from('work_report_items')
        .select('machine, duration_minutes')
        .in('report_id', legacyReportIds)
        .not('machine', 'is', null)

      if (itemError) {
        console.error('Supabaseエラー:', itemError)
        return NextResponse.json({ error: itemError.message }, { status: 500 })
      }

      for (const item of items || []) {
        if (item.machine && item.machine.trim()) {
          const key = item.machine.trim()
          const current = aggregation.get(key) || 0
          aggregation.set(key, current + (item.duration_minutes || 0))
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
