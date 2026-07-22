import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { parseShinseiWorkReportRows } from '@/lib/shinsei-work-report-csv'
import { importShinseiWorkReports } from '@/lib/shinsei-work-report-import'

export const runtime = 'nodejs'
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function sheetToRows(buffer: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    codepage: 932,
    raw: false,
    cellDates: false,
  })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const dryRun = String(formData.get('dry_run') || '') === '1'

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file が必要です' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length === 0) {
      return NextResponse.json({ error: '空のファイルです' }, { status: 400 })
    }

    const rows = sheetToRows(buffer)
    if (rows.length === 0) {
      return NextResponse.json({ error: 'CSVにデータ行がありません' }, { status: 400 })
    }

    if (dryRun) {
      const parsed = parseShinseiWorkReportRows(rows)
      return NextResponse.json({
        success: true,
        dry_run: true,
        parse: {
          ...parsed.stats,
          skipped_count: parsed.skipped.length,
        },
        skipped_sample: parsed.skipped.slice(0, 20),
        warning_sample: parsed.reports
          .flatMap((r) => r.warnings.map((w) => `${r.login_id} ${r.work_date}: ${w}`))
          .slice(0, 30),
        sample_reports: parsed.reports.slice(0, 3).map((r) => ({
          login_id: r.login_id,
          staff_name: r.staff_name,
          work_date: r.work_date,
          work_minutes: r.work_minutes,
          item_count: r.items.length,
          items: r.items.slice(0, 3),
        })),
      })
    }

    const summary = await importShinseiWorkReports(supabase, rows, { syncMonthly: true })
    return NextResponse.json({
      success: true,
      dry_run: false,
      message: `取込完了: ${summary.imported}件（新規 ${summary.created} / 上書き ${summary.overwritten}）`,
      ...summary,
    })
  } catch (error) {
    console.error('申請書日報取込エラー:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取込に失敗しました' },
      { status: 500 }
    )
  }
}
