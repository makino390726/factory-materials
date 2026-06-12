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

    // 期間内の作業日報を取得
    const { data: reports, error: reportError } = await supabase
      .from('work_reports')
      .select('id, work_date, staff_id, staffs(work_group_code)')
      .gte('work_date', from)
      .lte('work_date', to)

    if (reportError) {
      console.error('Supabaseエラー:', reportError)
      return NextResponse.json({ error: reportError.message }, { status: 500 })
    }

    const reportIds = (reports || []).map((report) => report.id)

    let itemsData: any[] = []
    if (reportIds.length > 0) {
      const { data: items, error: itemError } = await supabase
        .from('work_report_items')
        .select('report_id, is_support, support_work_group_code, work_type, work_content, duration_minutes')
        .in('report_id', reportIds)

      if (itemError) {
        console.error('Supabaseエラー:', itemError)
        return NextResponse.json({ error: itemError.message }, { status: 500 })
      }

      itemsData = items || []
    }

    // 作業グループマスターを取得
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

    // 作業グループごとに集計
    const groupTotals = new Map<string, { 
      work_group_code: string
      work_group_name: string
      total_minutes: number 
    }>()

    for (const report of reports || []) {
      const staffWorkGroupCode = (report.staffs as any)?.work_group_code
      const reportItems = itemsData.filter((item) => item.report_id === report.id)

      for (const item of reportItems) {
        // 実際の作業グループコードを判定（応援フラグを考慮）
        const actualWorkGroupCode = item.is_support 
          ? item.support_work_group_code 
          : staffWorkGroupCode

        if (!actualWorkGroupCode) continue

        const existing = groupTotals.get(actualWorkGroupCode) || {
          work_group_code: actualWorkGroupCode,
          work_group_name: workGroupMap.get(actualWorkGroupCode) || actualWorkGroupCode,
          total_minutes: 0
        }

        existing.total_minutes += item.duration_minutes || 0
        groupTotals.set(actualWorkGroupCode, existing)
      }
    }

    // 配列に変換してソート
    const result = Array.from(groupTotals.values())
      .sort((a, b) => a.work_group_code.localeCompare(b.work_group_code))

    return NextResponse.json(result)
  } catch (error) {
    console.error('作業グループ別集計エラー:', error)
    return NextResponse.json({ error: '作業グループ別集計に失敗しました' }, { status: 500 })
  }
}
