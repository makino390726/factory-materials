import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureCanonicalProductCode } from '@/lib/product-code-migrate'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function resolveTargetDate(searchParams: URLSearchParams): string {
  const date = searchParams.get('date')?.trim()
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

function jstDayRange(dateStr: string) {
  return {
    start: `${dateStr}T00:00:00+09:00`,
    end: `${dateStr}T23:59:59.999+09:00`,
  }
}

function isZeroPrefixNumericCode(code: string): boolean {
  const trimmed = String(code || '').trim()
  return /^\d+$/.test(trimmed) && trimmed.startsWith('00') && trimmed.length > 2
}

async function fetchZeroPrefixCodesInRange(range: { start: string; end: string }) {
  const codes = new Set<string>()

  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('product_code')
      .gte('created_at', range.start)
      .lte('created_at', range.end)
      .range(from, from + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data) {
      const code = String(row.product_code || '').trim()
      if (isZeroPrefixNumericCode(code)) codes.add(code)
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  from = 0
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('product_code')
      .gte('created_at', range.start)
      .lte('created_at', range.end)
      .range(from, from + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data) {
      const code = String(row.product_code || '').trim()
      if (isZeroPrefixNumericCode(code)) codes.add(code)
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  return Array.from(codes).sort()
}

/** 指定日に取り込まれた 00 付き商品コードを正規コードへ振替 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const targetDate = resolveTargetDate(searchParams)
    const dryRun = searchParams.get('apply') !== '1'
    const range = jstDayRange(targetDate)

    const sourceCodes = await fetchZeroPrefixCodesInRange(range)

    if (sourceCodes.length === 0) {
      return NextResponse.json({
        targetDate,
        dryRun,
        message: '振替対象はありません',
        migrated: 0,
        results: [],
      })
    }

    const results: Array<{
      sourceCode: string
      targetCode: string
      status: 'preview' | 'migrated' | 'skipped' | 'error'
      error?: string
    }> = []

    for (const sourceCode of sourceCodes) {
      const targetCode = sourceCode.slice(2)

      const { data: sourceProduct } = await supabase
        .from('products')
        .select('product_code')
        .eq('product_code', sourceCode)
        .maybeSingle()

      if (!sourceProduct) {
        results.push({ sourceCode, targetCode, status: 'skipped' })
        continue
      }

      if (dryRun) {
        results.push({ sourceCode, targetCode, status: 'preview' })
        continue
      }

      try {
        const resolved = await ensureCanonicalProductCode(supabase, targetCode)
        results.push({
          sourceCode,
          targetCode: resolved,
          status: resolved !== sourceCode || sourceCode !== targetCode ? 'migrated' : 'skipped',
        })
      } catch (err) {
        results.push({
          sourceCode,
          targetCode,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const migrated = results.filter((r) => r.status === 'migrated').length
    const errors = results.filter((r) => r.status === 'error').length

    return NextResponse.json({
      targetDate,
      dryRun,
      message: dryRun
        ? `振替予定 ${results.filter((r) => r.status === 'preview').length} 件（実行するには ?apply=1）`
        : `振替完了 ${migrated} 件${errors > 0 ? ` / エラー ${errors} 件` : ''}`,
      migrated,
      errors,
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '振替処理に失敗しました'
    console.error('00付き振替エラー:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
