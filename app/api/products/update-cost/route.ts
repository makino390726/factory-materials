import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncWorkOrderCostItemsForProductCodes } from '@/lib/work-order-cost-from-product-master'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 原価更新API（product_codeで検索してcost_priceを更新）
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { product_code, cost_price } = body

    if (!product_code) {
      return NextResponse.json({ error: '商品コードが必要です' }, { status: 400 })
    }

    if (cost_price === null || cost_price === undefined) {
      return NextResponse.json({ error: '原価が必要です' }, { status: 400 })
    }

    // product_codeで製品を検索
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('product_code', product_code)
      .single()

    if (!product) {
      return NextResponse.json({ error: '該当する製品が見つかりません' }, { status: 404 })
    }

    // cost_priceを更新
    const { data, error } = await supabase
      .from('products')
      .update({ cost_price: Number(cost_price) })
      .eq('product_code', product_code)
      .select()

    if (error) {
      console.error('更新エラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let work_order_cost_sync: Record<string, unknown> = { ok: true, updated: 0 }
    try {
      work_order_cost_sync = {
        ok: true,
        ...(await syncWorkOrderCostItemsForProductCodes(supabase, [product_code])),
      }
    } catch (syncErr) {
      console.error('原価明細同期エラー（原価更新後）:', syncErr)
      work_order_cost_sync = {
        ok: false,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      }
    }

    return NextResponse.json({ success: true, data: data[0], work_order_cost_sync })
  } catch (error) {
    console.error('原価更新エラー:', error)
    return NextResponse.json({ error: '原価更新に失敗しました' }, { status: 500 })
  }
}
