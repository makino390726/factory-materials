import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const fromDate = searchParams.get('from')
    const toDate = searchParams.get('to')
    const staffId = searchParams.get('staff_id')

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: '期間を指定してください' },
        { status: 400 }
      )
    }

    // スタッフ一覧を取得
    let staffQuery = supabase
      .from('staffs')
      .select('id, login_id, name, department, work_group_code')
      .order('login_id')

    const { data: staffs, error: staffError } = await staffQuery

    if (staffError) {
      console.error('スタッフ取得エラー:', staffError)
      return NextResponse.json(
        { error: 'スタッフ情報の取得に失敗しました' },
        { status: 500 }
      )
    }

    // 指定されたスタッフまたは全スタッフの日報明細を取得
    const staffIds = staffId ? [staffId] : (staffs || []).map(s => s.id)

    const { data: reports, error: reportError } = await supabase
      .from('work_reports')
      .select(`
        id,
        staff_id,
        work_date,
        start_time,
        end_time,
        break_minutes,
        work_minutes,
        is_draft
      `)
      .gte('work_date', fromDate)
      .lte('work_date', toDate)
      .in('staff_id', staffIds)
      .order('work_date', { ascending: true })

    if (reportError) {
      console.error('日報取得エラー:', reportError)
      return NextResponse.json(
        { error: '日報の取得に失敗しました' },
        { status: 500 }
      )
    }

    // 日報IDリストを取得
    const reportIds = (reports || []).map(r => r.id)

    // 日報明細を取得
    const { data: items, error: itemsError } = await supabase
      .from('work_report_items')
      .select('*')
      .in('report_id', reportIds)
      .order('start_time')

    if (itemsError) {
      console.error('明細取得エラー:', itemsError)
      return NextResponse.json(
        { error: '明細の取得に失敗しました' },
        { status: 500 }
      )
    }

    // ライン情報を取得
    const { data: lines } = await supabase
      .from('lines')
      .select('id, line_code, name')

    // スタッフごとにデータをグループ化
    const staffDetails = (staffs || []).map(staff => {
      const staffReports = (reports || []).filter(r => r.staff_id === staff.id)
      const reportsWithItems = staffReports.map(report => {
        const reportItems = (items || []).filter(i => i.report_id === report.id)
        const itemsWithLineInfo = reportItems.map(item => {
          const line = (lines || []).find(l => l.id === item.line_id)
          return {
            ...item,
            line_code: line?.line_code,
            line_name: line?.name,
          }
        })
        return {
          ...report,
          items: itemsWithLineInfo,
        }
      })

      return {
        staff,
        reports: reportsWithItems,
      }
    }).filter(sd => sd.reports.length > 0) // 日報があるスタッフのみ

    return NextResponse.json({
      success: true,
      data: staffDetails,
    })
  } catch (error) {
    console.error('API エラー:', error)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
