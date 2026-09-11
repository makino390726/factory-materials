import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentFiscalYear, parseFiscalYearParam } from '@/lib/fiscal-year'
import { loadLineCostForPartYear } from '@/lib/line-cost-carryover'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 特定の part_key に紐づく work_order_cost_items を取得（LINE分のみ）
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const part_key = url.searchParams.get('part_key')

    if (!part_key) {
      return NextResponse.json({ error: 'part_key required' }, { status: 400 })
    }

    const fiscalYear = parseFiscalYearParam(
      url.searchParams.get('fiscal_year'),
      getCurrentFiscalYear()
    )
    const bundle = await loadLineCostForPartYear(supabase, part_key, fiscalYear, {
      allowPreviousYearFallback: true,
    })
    const items = bundle?.items || []
    const sourceYear = bundle?.header.fiscal_year != null ? Number(bundle.header.fiscal_year) : fiscalYear
    return NextResponse.json({
      items,
      fiscal_year: fiscalYear,
      source_fiscal_year: Number.isFinite(sourceYear) ? sourceYear : fiscalYear,
    })
  } catch (err) {
    console.error('work_order_cost_items by part_key error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
