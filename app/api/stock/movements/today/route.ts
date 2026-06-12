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
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // 当日の日付範囲を取得（日本時間）
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart)
    todayEnd.setDate(todayEnd.getDate() + 1)

    console.log('📅 当日履歴取得:', { todayStart: todayStart.toISOString(), limit, offset })

    // stock_movements テーブルから当日のデータを取得
    const { data: movements, error: movementsError, count } = await supabase
      .from('stock_movements')
      .select(
        `
        id,
        product_code,
        movement,
        qty,
        input_method,
        note,
        login_id,
        staff_name,
        created_at
        `,
        { count: 'exact' }
      )
      .gte('created_at', todayStart.toISOString())
      .lt('created_at', todayEnd.toISOString())
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (movementsError) {
      console.error('履歴取得エラー:', movementsError)
      return NextResponse.json(
        { success: false, error: movementsError.message },
        { status: 500 }
      )
    }

    // 製品情報をバッチで取得
    const productCodes = [...new Set((movements || []).map((m) => m.product_code))]

    if (productCodes.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        total: 0,
        offset,
        limit,
      })
    }

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('product_code, name')
      .in('product_code', productCodes)

    if (productsError) {
      console.error('製品情報取得エラー:', productsError)
      // エラーでも履歴は返す（製品名なしで）
      const withoutProducts = (movements || []).map((m) => ({
        ...m,
        product_name: '(未登録)',
      }))

      return NextResponse.json({
        success: true,
        data: withoutProducts,
        total: count || 0,
        offset,
        limit,
      })
    }

    const productsMap = new Map((products || []).map((p) => [p.product_code, p.name]))

    // 履歴データに製品名を付与
    const enrichedMovements = (movements || []).map((m) => ({
      ...m,
      product_name: productsMap.get(m.product_code) || '(未登録)',
      movement_label:
        m.movement === 'IN'
          ? '入庫'
          : m.movement === 'OUT'
            ? '出庫'
            : m.movement === 'ADJUST'
              ? '棚卸'
              : m.movement,
    }))

    console.log('✅ 当日履歴取得成功:', { count: enrichedMovements.length, total: count })

    return NextResponse.json({
      success: true,
      data: enrichedMovements,
      total: count || 0,
      offset,
      limit,
    })
  } catch (error) {
    console.error('当日履歴取得エラー:', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
