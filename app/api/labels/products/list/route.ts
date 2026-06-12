import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Supabaseクライアントを初期化
// サービスロールキーを使用してRLS制限を回避
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Supabase環境変数が設定されていません')
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

type ProductListRow = {
  product_code: string
  name: string | null
  shelf_no: string | null
}

type StockShelfRow = {
  product_code: string
  shelf_no: string | null
}

async function fetchStockShelfMap() {
  const batchSize = 1000
  const stockShelfMap = new Map<string, string | null>()
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('stocks')
      .select('product_code, shelf_no')
      .range(offset, offset + batchSize - 1)
      .order('product_code', { ascending: true })

    if (error) {
      throw error
    }

    const rows = (data || []) as StockShelfRow[]
    for (const row of rows) {
      if (!stockShelfMap.has(row.product_code)) {
        stockShelfMap.set(row.product_code, row.shelf_no || null)
      }
    }

    if (rows.length < batchSize) {
      break
    }

    offset += batchSize
  }

  return stockShelfMap
}

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API呼び出し開始')
    console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓ 設定済み' : '✗ 未設定')
    console.log('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceRoleKey ? '✓ 設定済み' : '✗ 未設定')

    // クエリパラメータで製品絞り込み可能にする（オプション）
    const searchParams = request.nextUrl.searchParams
    const searchTerm = searchParams.get('search')?.toLowerCase()

    console.log('📊 Supabaseからproductsテーブルで全製品を取得中...')

    // Supabaseからproductsテーブルをバッチ取得（1000件制限回避）
    const batchSize = 1000
    let offset = 0
    let allData: { product_code: string; name: string; shelf_no: string | null }[] = []
    let totalCount: number | null = null
    const stockShelfMap = await fetchStockShelfMap()

    while (true) {
      let query = supabase
        .from('products')
        .select('product_code, name, shelf_no', { count: 'exact' })
        .range(offset, offset + batchSize - 1)
        .order('product_code', { ascending: true })

      // 検索ワードがある場合はフィルタリング
      if (searchTerm) {
        console.log('🔎 検索ワード:', searchTerm)
        query = query.or(`product_code.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`)
      }

      const { data, error, count } = await query

      console.log('📈 レスポンス:', { dataLength: data?.length, error: error?.message, count })

      if (error) {
        console.error('❌ Supabaseエラー:', error)
        return NextResponse.json(
          { success: false, error: `データベースの取得に失敗しました: ${error.message}` },
          { status: 500 }
        )
      }

      if (!data || data.length === 0) {
        break
      }

      if (totalCount === null) {
        totalCount = count ?? null
      }

      const mapped = (data as ProductListRow[]).map(product => ({
        product_code: product.product_code,
        name: product.name || '(未登録)',
        shelf_no: (stockShelfMap.get(product.product_code) ?? product.shelf_no) || null,
      }))

      allData = allData.concat(mapped)

      if (data.length < batchSize) {
        break
      }

      offset += batchSize
    }

    if (allData.length === 0) {
      console.warn('⚠️ Supabaseから空のデータが返されました')
      return NextResponse.json({
        success: true,
        data: [],
        total: 0,
      })
    }

    // product_codeの重複を除去（念のため）
    const uniqueMap = new Map<string, { product_code: string; name: string; shelf_no: string | null }>()
    for (const item of allData) {
      if (!uniqueMap.has(item.product_code)) {
        uniqueMap.set(item.product_code, item)
      }
    }
    const uniqueData = Array.from(uniqueMap.values())

    console.log(`✅ Supabaseから${uniqueData.length}件の製品を取得しました`)
    if (uniqueData.length > 0) {
      console.log('📦 最初の製品:', uniqueData[0])
    }

    return NextResponse.json({
      success: true,
      data: uniqueData,
      total: uniqueData.length,
    })
  } catch (error) {
    console.error('❌ 製品取得エラー:', error)
    return NextResponse.json(
      { success: false, error: `製品データの取得に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}` },
      { status: 500 }
    )
  }
}
