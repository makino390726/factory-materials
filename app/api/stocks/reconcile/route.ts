import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

const normalizeCode = (code: string) => {
  const trimmed = code.trim()
  if (/^\d+$/.test(trimmed)) {
    return trimmed.replace(/^0+/, '') || '0'
  }
  return trimmed
}

export async function POST() {
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('product_code')

    if (productsError) {
      return NextResponse.json(
        { success: false, error: productsError.message },
        { status: 500 }
      )
    }

    const { data: stocks, error: stocksError } = await supabase
      .from('stocks')
      .select('product_code')

    if (stocksError) {
      return NextResponse.json(
        { success: false, error: stocksError.message },
        { status: 500 }
      )
    }

    const productCodeSet = new Set((products || []).map(p => p.product_code))
    const normalizedProductMap = new Map<string, string>()

    for (const p of products || []) {
      normalizedProductMap.set(normalizeCode(p.product_code), p.product_code)
    }

    const existingStockCodes = new Set((stocks || []).map(s => s.product_code))

    let updatedCount = 0
    let skippedCount = 0
    const conflicts: Array<{ from: string; to: string }> = []

    for (const stock of stocks || []) {
      const originalCode = stock.product_code

      if (productCodeSet.has(originalCode)) {
        continue
      }

      const normalized = normalizeCode(originalCode)
      const targetCode = normalizedProductMap.get(normalized)

      if (!targetCode || targetCode === originalCode) {
        skippedCount++
        continue
      }

      if (existingStockCodes.has(targetCode)) {
        conflicts.push({ from: originalCode, to: targetCode })
        skippedCount++
        continue
      }

      const { error: updateError } = await supabase
        .from('stocks')
        .update({ product_code: targetCode })
        .eq('product_code', originalCode)

      if (updateError) {
        return NextResponse.json(
          { success: false, error: updateError.message },
          { status: 500 }
        )
      }

      existingStockCodes.delete(originalCode)
      existingStockCodes.add(targetCode)
      updatedCount++
    }

    return NextResponse.json({
      success: true,
      updatedCount,
      skippedCount,
      conflicts,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
