import { NextRequest, NextResponse } from 'next/server'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'

export const runtime = 'nodejs'

const ESTIMATE_ORIGIN =
  process.env.ESTIMATE_SYSTEM_ORIGIN ||
  process.env.NEXT_PUBLIC_ESTIMATE_SYSTEM_ORIGIN ||
  'https://estimate-system-ten.vercel.app'

export type SalesPlanQtyRow = {
  machine_code: string
  machine_name: string
  qty: number
  highQty: number
  amount: number
}

/**
 * 見積システム年度計画（個人シート）の機種別台数を取得する代理API。
 * GET /api/heater/manufacturing-plan/sales-qty?fiscalYear=2026
 */
export async function GET(request: NextRequest) {
  try {
    const fiscalYearParam = request.nextUrl.searchParams.get('fiscalYear')
    const fiscalYear = fiscalYearParam
      ? Number(fiscalYearParam)
      : getCurrentFiscalYear()

    if (!Number.isFinite(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ ok: false, error: 'fiscalYear が不正です' }, { status: 400 })
    }

    const url = new URL('/api/plan/annual/model-qty', ESTIMATE_ORIGIN)
    url.searchParams.set('fiscalYear', String(fiscalYear))

    const res = await fetch(url.toString(), { cache: 'no-store' })
    const text = await res.text()
    let data: {
      ok?: boolean
      error?: string
      fiscalYear?: number
      rows?: SalesPlanQtyRow[]
    } = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: `見積システムの応答が不正です (${res.status})`,
        },
        { status: 502 }
      )
    }

    if (!res.ok || data.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: data.error || `見積システムから取得できませんでした (${res.status})`,
        },
        { status: res.ok ? 502 : res.status }
      )
    }

    const rows = Array.isArray(data.rows) ? data.rows : []
    return NextResponse.json({
      ok: true,
      fiscalYear: data.fiscalYear ?? fiscalYear,
      source: ESTIMATE_ORIGIN,
      rows: rows.map((row) => ({
        machine_code: String(row.machine_code || '').trim(),
        machine_name: String(row.machine_name || row.machine_code || '').trim(),
        qty: Number(row.qty) || 0,
        highQty: Number(row.highQty) || 0,
        amount: Number(row.amount) || 0,
      })),
    })
  } catch (error) {
    console.error('sales-qty proxy error:', error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : '営業計画台数の取得に失敗しました',
      },
      { status: 500 }
    )
  }
}
