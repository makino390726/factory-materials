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
      .select('id, work_date, staff_id')
      .gte('work_date', from)
      .lte('work_date', to)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const reportIds = (reports || []).map((report) => report.id)

    let itemsData: Array<{ report_id: number; work_type: string; duration_minutes: number | null }> = []
    if (reportIds.length > 0) {
      const { data: items, error: itemError } = await supabase
        .from('work_report_items')
        .select('report_id, work_type, duration_minutes')
        .in('report_id', reportIds)

      if (itemError) {
        console.error('Supabaseエラー:', itemError)
        return NextResponse.json({ error: itemError.message }, { status: 500 })
      }

      itemsData = items || []
    }

    const result = (reports || []).map((report) => {
      const items = itemsData.filter((item) => item.report_id === report.id)
      const direct = items
        .filter((item) => item.work_type === 'direct')
        .reduce((sum, item) => sum + (item.duration_minutes || 0), 0)
      const indirect = items
        .filter((item) => item.work_type === 'indirect')
        .reduce((sum, item) => sum + (item.duration_minutes || 0), 0)

      return {
        work_date: report.work_date,
        direct_minutes: direct,
        indirect_minutes: indirect,
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('日別集計エラー:', error)
    return NextResponse.json({ error: '日別集計に失敗しました' }, { status: 500 })
  }
}
