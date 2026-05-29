import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncWorkOrderCostItemsForProductCodes } from '@/lib/work-order-cost-from-product-master'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ProductRow = Record<string, unknown> & {
  product_code: string
  shelf_no?: string | null
}

type StockShelfRow = {
  product_code: string
  shelf_no: string | null
}

type StockRow = {
  product_code: string
}

async function fetchStockShelfMap() {
  const PAGE_SIZE = 1000
  const stockShelfMap = new Map<string, string | null>()
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('stocks')
      .select('product_code, shelf_no')
      .order('product_code', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw error
    }

    const rows = (data || []) as StockShelfRow[]
    for (const row of rows) {
      if (!stockShelfMap.has(row.product_code)) {
        stockShelfMap.set(row.product_code, row.shelf_no || null)
      }
    }

    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return stockShelfMap
}

async function syncStockShelf(
  productCode: string,
  shelfNo: string | null,
  previousProductCode = productCode,
  createWhenMissing = false
) {
  const timestamp = new Date().toISOString()

  const { data: existingStock, error: existingStockError } = await supabase
    .from('stocks')
    .select('product_code')
    .eq('product_code', previousProductCode)
    .maybeSingle<StockRow>()

  if (existingStockError) {
    throw existingStockError
  }

  if (existingStock) {
    const { error: updateError } = await supabase
      .from('stocks')
      .update({
        product_code: productCode,
        shelf_no: shelfNo,
        updated_at: timestamp,
      })
      .eq('product_code', previousProductCode)

    if (updateError) {
      throw updateError
    }

    return
  }

  if (previousProductCode !== productCode) {
    const { data: targetStock, error: targetStockError } = await supabase
      .from('stocks')
      .select('product_code')
      .eq('product_code', productCode)
      .maybeSingle<StockRow>()

    if (targetStockError) {
      throw targetStockError
    }

    if (targetStock) {
      const { error: targetUpdateError } = await supabase
        .from('stocks')
        .update({
          shelf_no: shelfNo,
          updated_at: timestamp,
        })
        .eq('product_code', productCode)

      if (targetUpdateError) {
        throw targetUpdateError
      }

      return
    }
  }

  if (!createWhenMissing && shelfNo === null) {
    return
  }

  const { error: upsertError } = await supabase
    .from('stocks')
    .upsert(
      {
        product_code: productCode,
        shelf_no: shelfNo,
        updated_at: timestamp,
      },
      { onConflict: 'product_code' }
    )

  if (upsertError) {
    throw upsertError
  }
}

// 製品一覧取得（全件）
export async function GET() {
  try {
    const PAGE_SIZE = 1000
    let allData: ProductRow[] = []
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('product_code', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        console.error('Supabaseエラー:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      allData = allData.concat((data || []) as ProductRow[])

      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const stockShelfMap = await fetchStockShelfMap()
    const mergedData = allData.map((product) => ({
      ...product,
      shelf_no: stockShelfMap.get(product.product_code) ?? product.shelf_no ?? null,
    }))

    return NextResponse.json(mergedData)
  } catch (error) {
    console.error('製品取得エラー:', error)
    return NextResponse.json({ error: '製品取得に失敗しました' }, { status: 500 })
  }
}

// 製品登録
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { product_code, name, shelf_no, barcode, purchase_price, cost_price } = body
    const normalizedShelfNo = shelf_no || null

    if (!product_code || !name) {
      return NextResponse.json({ error: '商品コードと製品名は必須です' }, { status: 400 })
    }

    // 重複チェック
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('product_code', product_code)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'この商品コードは既に登録されています' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('products')
      .insert([{ product_code, name, shelf_no: normalizedShelfNo, barcode, purchase_price, cost_price }])
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await syncStockShelf(product_code, normalizedShelfNo, product_code, normalizedShelfNo !== null)

    let work_order_cost_sync: Record<string, unknown> = { ok: true, updated: 0 }
    try {
      work_order_cost_sync = {
        ok: true,
        ...(await syncWorkOrderCostItemsForProductCodes(supabase, [product_code])),
      }
    } catch (syncErr) {
      console.error('原価明細同期エラー（製品登録後）:', syncErr)
      work_order_cost_sync = {
        ok: false,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      }
    }

    return NextResponse.json({ ...data[0], work_order_cost_sync })
  } catch (error) {
    console.error('製品登録エラー:', error)
    return NextResponse.json({ error: '製品登録に失敗しました' }, { status: 500 })
  }
}

// 製品更新
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { id, product_code, name, shelf_no, barcode, purchase_price, cost_price } = body
    const normalizedShelfNo = shelf_no || null

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    if (!product_code || !name) {
      return NextResponse.json({ error: '商品コードと製品名は必須です' }, { status: 400 })
    }

    const { data: currentProduct, error: currentProductError } = await supabase
      .from('products')
      .select('product_code')
      .eq('id', id)
      .maybeSingle<{ product_code: string }>()

    if (currentProductError) {
      console.error('製品取得エラー:', currentProductError)
      return NextResponse.json({ error: currentProductError.message }, { status: 500 })
    }

    if (!currentProduct) {
      return NextResponse.json({ error: '対象の製品が見つかりません' }, { status: 404 })
    }

    // 重複チェック（自分以外）
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('product_code', product_code)
      .neq('id', id)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'この商品コードは既に登録されています' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('products')
      .update({ product_code, name, shelf_no: normalizedShelfNo, barcode, purchase_price, cost_price })
      .eq('id', id)
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await syncStockShelf(product_code, normalizedShelfNo, currentProduct.product_code, normalizedShelfNo !== null)

    const syncCodes = Array.from(
      new Set([product_code, currentProduct.product_code].map((c) => String(c || '').trim()).filter(Boolean))
    )
    let work_order_cost_sync: Record<string, unknown> = { ok: true, updated: 0 }
    try {
      work_order_cost_sync = {
        ok: true,
        ...(await syncWorkOrderCostItemsForProductCodes(supabase, syncCodes)),
      }
    } catch (syncErr) {
      console.error('原価明細同期エラー（製品更新後）:', syncErr)
      work_order_cost_sync = {
        ok: false,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      }
    }

    return NextResponse.json({ ...data[0], work_order_cost_sync })
  } catch (error) {
    console.error('製品更新エラー:', error)
    return NextResponse.json({ error: '製品更新に失敗しました' }, { status: 500 })
  }
}

// 製品削除（単体: { id } / 一括: { ids: string[] }）
export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { id, ids } = body

    if (Array.isArray(ids) && ids.length > 0) {
      const validIds = ids.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
      if (validIds.length === 0) {
        return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
      }

      const { error } = await supabase.from('products').delete().in('id', validIds)

      if (error) {
        console.error('Supabaseエラー:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, deleted: validIds.length })
    }

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, deleted: 1 })
  } catch (error) {
    console.error('製品削除エラー:', error)
    return NextResponse.json({ error: '製品削除に失敗しました' }, { status: 500 })
  }
}
