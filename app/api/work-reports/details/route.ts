import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchByIdChunks, fetchWorkReportsInRange } from '@/lib/work-report-query'

export const runtime = 'nodejs'
export const maxDuration = 60

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

    const { data: staffs, error: staffError } = await supabase
      .from('staffs')
      .select('id, login_id, name, department, work_group_code')
      .order('login_id')

    if (staffError) {
      console.error('スタッフ取得エラー:', staffError)
      return NextResponse.json(
        { error: 'スタッフ情報の取得に失敗しました' },
        { status: 500 }
      )
    }

    type ReportRow = {
      id: string
      staff_id: string
      work_date: string
      start_time: string | null
      end_time: string | null
      break_minutes: number
      work_minutes: number | null
      is_draft: boolean
    }
    let reports = await fetchWorkReportsInRange<ReportRow>(
      supabase,
      fromDate,
      toDate,
      'id, staff_id, work_date, start_time, end_time, break_minutes, work_minutes, is_draft'
    )
    if (staffId) {
      reports = reports.filter((report) => String(report.staff_id) === String(staffId))
    }

    const items = await fetchByIdChunks<Record<string, unknown> & { report_id: string; line_id?: string | null }>(
      supabase,
      'work_report_items',
      '*',
      'report_id',
      reports.map((report) => String(report.id))
    )

    const { data: lines } = await supabase.from('lines').select('id, line_code, name')
    const lineMap = new Map((lines || []).map((line) => [line.id, line]))

    const itemsByReport = new Map<string, typeof items>()
    for (const item of items) {
      const key = String(item.report_id)
      const list = itemsByReport.get(key) || []
      list.push(item)
      itemsByReport.set(key, list)
    }

    const staffDetails = (staffs || [])
      .map((staff) => {
        const staffReports = reports.filter((report) => report.staff_id === staff.id)
        const reportsWithItems = staffReports.map((report) => {
          const reportItems = itemsByReport.get(String(report.id)) || []
          const itemsWithLineInfo = reportItems.map((item) => {
            const line = item.line_id ? lineMap.get(item.line_id) : undefined
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
      })
      .filter((sd) => sd.reports.length > 0)

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
