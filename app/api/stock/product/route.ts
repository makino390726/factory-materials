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
    const searchParams = request.nextUrl.searchParams
    const productCode = searchParams.get('code')

    console.log('🔍 製品コード検索:', productCode)

    if (!productCode) {
      return NextResponse.json(
        { success: false, error: '製品コードが必要です' },
        { status: 400 }
      )
    }

    // デバッグ：該当製品コードに近いものを検索
    const { data: similarProducts } = await supabase
      .from('products')
      .select('product_code, name')
      .ilike('product_code', `%${productCode.substring(0, 5)}%`)
      .limit(5)
    
    console.log('🔎 類似製品:', similarProducts)

    // 製品情報を取得
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('product_code, name')
      .eq('product_code', productCode)
      .maybeSingle()
    
    console.log('📦 製品データ:', product)
    if (productError) {
      console.error('❌ 製品エラー:', productError)
    }

    if (productError) {
      console.error('製品取得エラー:', productError)
      return NextResponse.json(
        { success: false, error: 'データベースエラー' },
        { status: 500 }
      )
    }

    if (!product) {
      return NextResponse.json(
        { success: false, error: '製品が見つかりません' },
        { status: 404 }
      )
    }

    // 在庫情報を取得
    const { data: stock, error: stockError } = await supabase
      .from('stocks')
      .select('*')
      .eq('product_code', productCode)
      .maybeSingle()

    // 在庫レコードが存在しない場合は0として扱う
    const stockInfo = stock ? { ...stock, current_stock: stock.stock_qty } : { current_stock: 0, stock_qty: 0, product_code: productCode }

    return NextResponse.json({
      success: true,
      data: product,
      stock: stockInfo,
    })
  } catch (error) {
    console.error('API エラー:', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
