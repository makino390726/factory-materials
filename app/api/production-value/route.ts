import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  buildProductionValueReport,
  getDefaultProductionValuePeriod,
  type ProductionValuePeriodMode,
} from '@/lib/production-value'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/production-value?period=month&year=2026&month=8
 * GET /api/production-value?period=year&year=2026
 *
 * 工程管理の完成ロット × 原価で生産額を集計
 * - 暖房機: L指令 903〜909（備考の機種/UF・DF）
 * - D指令: instruction ロット
 */
export async function GET(request: NextRequest) {
  try {
    const defaults = getDefaultProductionValuePeriod()
    const periodParam = (request.nextUrl.searchParams.get('period') || 'month').trim()
    const period_mode: ProductionValuePeriodMode =
      periodParam === 'year' ? 'year' : 'month'

    const yearRaw = request.nextUrl.searchParams.get('year')
    const monthRaw = request.nextUrl.searchParams.get('month')

    const year = yearRaw
      ? Number(yearRaw)
      : period_mode === 'year'
        ? getCurrentFiscalYear()
        : defaults.year

    const month =
      period_mode === 'month'
        ? monthRaw
          ? Number(monthRaw)
          : defaults.month
        : null

    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'year が不正です' }, { status: 400 })
    }
    if (
      period_mode === 'month' &&
      (!month || !Number.isFinite(month) || month < 1 || month > 12)
    ) {
      return NextResponse.json({ error: 'month が不正です' }, { status: 400 })
    }

    const report = await buildProductionValueReport(supabase, {
      period_mode,
      year,
      month,
    })

    return NextResponse.json(report)
  } catch (err) {
    console.error('production-value error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '生産額の集計に失敗しました' },
      { status: 500 }
    )
  }
}
