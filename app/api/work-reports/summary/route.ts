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

    const isDirectWorkType = (workType: string | null | undefined) => {
      if (!workType) return false
      const normalized = workType.trim().toLowerCase()

      // 直・直接 (Japanese) / direct (English)
      // Also treat common print types (ラベル / label) as "direct" work
      return (
        normalized === 'direct' ||
        normalized === '直' ||
        normalized === '直接' ||
        normalized === 'label' ||
        normalized === 'ラベル' ||
        normalized.includes('直') ||
        normalized.includes('direct') ||
        normalized.includes('ラベル') ||
        normalized.includes('label')
      )
    }

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
        const entry = itemMap.get(item.report_id) || { direct: 0, indirect: 0 }
        if (isDirectWorkType(item.work_type)) {
          entry.direct += item.duration_minutes || 0
        } else {
          entry.indirect += item.duration_minutes || 0
        }
        itemMap.set(item.report_id, entry)
      }
    }

    const summary = reportList.map((report) => {
      const totals = itemMap.get(report.id) || { direct: 0, indirect: 0 }
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
