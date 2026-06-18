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

const BATCH_SIZE = 1000

async function fetchAllStocks() {
  const rows: Array<{
    product_code: string
    name: string | null
    stock_qty: number | null
    unit_price: number | null
    total_amount: number | null
    updated_at: string | null
  }> = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('stocks_with_name')
      .select('product_code, name, stock_qty, unit_price, total_amount, updated_at')
      .order('product_code', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  return rows
}

async function fetchAllMovements() {
  const rows: Array<{
    product_code: string
    created_at: string
    movement: string
  }> = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('product_code, created_at, movement')
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  return rows
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const movementTypeParam = searchParams.get('movementType')
    const movementType = movementTypeParam === 'IN' || movementTypeParam === 'OUT' ? movementTypeParam : null
    const movementStartDate = searchParams.get('movementStartDate')
    const movementEndDate = searchParams.get('movementEndDate')
    const hasMovementFilter = Boolean(movementType || movementStartDate || movementEndDate)

    const stocks = await fetchAllStocks()
    const movements = await fetchAllMovements()

    const movementMap = new Map<string, string>()
    const matchingProductCodes = new Set<string>()

    const startAt = movementStartDate ? Date.parse(`${movementStartDate}T00:00:00`) : Number.NaN
    const endAt = movementEndDate ? Date.parse(`${movementEndDate}T23:59:59.999`) : Number.NaN

    for (const movement of movements || []) {
      if (!movementMap.has(movement.product_code)) {
        movementMap.set(movement.product_code, movement.created_at)
      }

      if (!hasMovementFilter) {
        continue
      }

      if (movementType && movement.movement !== movementType) {
        continue
      }

      const movementAt = Date.parse(movement.created_at)
      if (Number.isNaN(movementAt)) {
        continue
      }

      if (!Number.isNaN(startAt) && movementAt < startAt) {
        continue
      }

      if (!Number.isNaN(endAt) && movementAt > endAt) {
        continue
      }

      matchingProductCodes.add(movement.product_code)
    }

    // 在庫ベースで一覧を作成（表示件数は stocks の件数）
    const inventory = (stocks || []).map(stock => {
      const lastMovementAt = movementMap.get(stock.product_code) || null
      return {
        product_code: stock.product_code,
        name: (stock as { name?: string | null }).name || '(未登録)',
        stock_qty: stock.stock_qty || 0,
        unit_price: (stock as { unit_price?: number | null }).unit_price ?? null,
        total_amount: (stock as { total_amount?: number | null }).total_amount ?? null,
        updated_at: stock.updated_at || new Date().toISOString(),
        last_movement_at: lastMovementAt,
        has_movement: Boolean(lastMovementAt),
        matches_movement_filter: !hasMovementFilter || matchingProductCodes.has(stock.product_code),
      }
    })

    return NextResponse.json({
      success: true,
      data: inventory,
      count: inventory.length,
    })
  } catch (error) {
    console.error('API エラー:', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
