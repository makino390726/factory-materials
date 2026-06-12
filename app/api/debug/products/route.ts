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
    // 最初の10件を取得
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .limit(10)

    if (error) {
      return NextResponse.json({
        success: false,
        error: error.message,
        details: error,
      })
    }

    // P-10006を検索
    const { data: specificProduct, error: specificError } = await supabase
      .from('products')
      .select('*')
      .eq('product_code', 'P-10006')
      .maybeSingle()

    // stocksテーブルの構造を確認
    const { data: stocksSample, error: stocksError } = await supabase
      .from('stocks')
      .select('*')
      .limit(5)

    // stock_movementsテーブルの構造を確認
    const { data: movementsSample, error: movementsError } = await supabase
      .from('stock_movements')
      .select('*')
      .limit(5)

    return NextResponse.json({
      success: true,
      first10Products: products,
      productP10006: specificProduct,
      searchError: specificError,
      totalCount: products?.length || 0,
      stocksTableSample: stocksSample,
      stocksTableError: stocksError,
      movementsTableSample: movementsSample,
      movementsTableError: movementsError,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error),
    })
  }
}
