import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentFiscalYear, parseFiscalYearParam } from '@/lib/fiscal-year'
import { carryOverLineCostsFromPreviousYear } from '@/lib/line-cost-carryover'
import { formatPostgrestError } from '@/lib/supabase-error'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** POST: 前年度の L指令→パーツ→構成部品を現年度へ繰越す（工費は除く） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const toYear = parseFiscalYearParam(body?.to_year, getCurrentFiscalYear())
    const fromYear = parseFiscalYearParam(body?.from_year, toYear - 1)
    const result = await carryOverLineCostsFromPreviousYear(supabase, { fromYear, toYear })
    return NextResponse.json({
      success: true,
      ...result,
      message: `${result.from_year}年度の L指令→パーツ→構成部品 ${result.copied} 件を${result.to_year}年度へ繰り越しました（スキップ ${result.skipped} 件）`,
    })
  } catch (err) {
    console.error('line cost carry-over error:', err)
    return NextResponse.json(
      { error: formatPostgrestError(err, '繰越に失敗しました') },
      { status: 500 }
    )
  }
}
