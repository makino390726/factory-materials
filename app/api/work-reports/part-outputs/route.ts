import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getFiscalYearDateRange, parseFiscalYearParam } from '@/lib/fiscal-year'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 確定日報から、L指令の構成パーツ制作数を年度合計する */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const lineId = url.searchParams.get('line_id')?.trim()
    const fiscalYear = parseFiscalYearParam(url.searchParams.get('fiscal_year'))
    if (!lineId) {
      return NextResponse.json({ error: 'line_id は必須です' }, { status: 400 })
    }

    const { start, end } = getFiscalYearDateRange(fiscalYear)
    const { data: outputs, error } = await supabase
      .from('work_report_part_outputs')
      .select('part_key, produced_qty, report_item_id')
      .eq('line_id', lineId)

    if (error) {
      if (String(error.message || '').includes('work_report_part_outputs')) {
        return NextResponse.json({ produced: {}, fiscal_year: fiscalYear })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = outputs || []
    if (rows.length === 0) {
      return NextResponse.json({ produced: {}, fiscal_year: fiscalYear })
    }

    const itemIds = [...new Set(rows.map((row) => String(row.report_item_id || '')).filter(Boolean))]
    const { data: items, error: itemError } = await supabase
      .from('work_report_items')
      .select('id, report_id')
      .in('id', itemIds)
    if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 })

    const reportIds = [...new Set((items || []).map((item) => String(item.report_id || '')).filter(Boolean))]
    const { data: reports, error: reportError } = await supabase
      .from('work_reports')
      .select('id, work_date, is_draft')
      .in('id', reportIds.length > 0 ? reportIds : ['00000000-0000-0000-0000-000000000000'])
    if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 })

    const confirmedReportIds = new Set(
      (reports || [])
        .filter((report) => !report.is_draft && String(report.work_date) >= start && String(report.work_date) <= end)
        .map((report) => String(report.id))
    )
    const confirmedItemIds = new Set(
      (items || [])
        .filter((item) => confirmedReportIds.has(String(item.report_id)))
        .map((item) => String(item.id))
    )

    const produced: Record<string, number> = {}
    for (const row of rows) {
      if (!confirmedItemIds.has(String(row.report_item_id))) continue
      const key = String(row.part_key || '').trim()
      if (!key) continue
      produced[key] = (produced[key] || 0) + Number(row.produced_qty || 0)
    }

    return NextResponse.json({ produced, fiscal_year: fiscalYear })
  } catch (err) {
    console.error('part outputs summary error:', err)
    return NextResponse.json({ error: '制作数の集計に失敗しました' }, { status: 500 })
  }
}
