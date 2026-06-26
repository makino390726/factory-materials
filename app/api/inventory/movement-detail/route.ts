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

async function fetchProductMaps() {
  const shelfMap = new Map<string, string | null>()
  const nameMap = new Map<string, string>()
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('product_code, shelf_no, name')
      .order('product_code', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data) {
      const shelfNo = row.shelf_no ? String(row.shelf_no).trim() : ''
      shelfMap.set(row.product_code, shelfNo || null)
      nameMap.set(row.product_code, row.name || '(未登録)')
    }
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  return { shelfMap, nameMap }
}

async function fetchCurrentStockMap() {
  const stockMap = new Map<string, number>()
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('stocks')
      .select('product_code, stock_qty')
      .order('product_code', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data) {
      stockMap.set(row.product_code, Number(row.stock_qty) || 0)
    }
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  return stockMap
}

async function fetchMovementsInRange(countDate: string, auditDate: string) {
  const rows: Array<{
    product_code: string
    movement: string
    qty: number | null
  }> = []
  let offset = 0
  const startAt = `${countDate}T00:00:00`
  const endAt = `${auditDate}T23:59:59.999`

  while (true) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('product_code, movement, qty')
      .gte('created_at', startAt)
      .lte('created_at', endAt)
      .order('created_at', { ascending: true })
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
    const countDate = searchParams.get('countDate')?.trim()
    const auditDate = searchParams.get('auditDate')?.trim()

    if (!countDate || !auditDate) {
      return NextResponse.json(
        { success: false, error: '棚卸日と現物監査日を指定してください' },
        { status: 400 }
      )
    }

    if (countDate > auditDate) {
      return NextResponse.json(
        { success: false, error: '棚卸日は現物監査日以前の日付を指定してください' },
        { status: 400 }
      )
    }

    const [movements, { shelfMap, nameMap }, stockMap] = await Promise.all([
      fetchMovementsInRange(countDate, auditDate),
      fetchProductMaps(),
      fetchCurrentStockMap(),
    ])

    const aggMap = new Map<string, { inbound_qty: number; outbound_qty: number }>()

    for (const movement of movements) {
      const code = movement.product_code
      if (!code) continue

      const qty = Number(movement.qty) || 0
      if (qty <= 0) continue

      const current = aggMap.get(code) || { inbound_qty: 0, outbound_qty: 0 }
      const type = String(movement.movement || '').toUpperCase()

      if (type === 'IN') {
        current.inbound_qty += qty
      } else if (type === 'OUT') {
        current.outbound_qty += qty
      }

      aggMap.set(code, current)
    }

    const productCodes = new Set<string>([
      ...Array.from(aggMap.keys()),
      ...Array.from(stockMap.keys()),
    ])

    const data = Array.from(productCodes)
      .map((product_code) => {
        const agg = aggMap.get(product_code) || { inbound_qty: 0, outbound_qty: 0 }
        const audit_stock_qty = stockMap.get(product_code) ?? 0
        const count_day_stock = audit_stock_qty - agg.inbound_qty + agg.outbound_qty

        return {
          shelf_no: shelfMap.get(product_code) ?? null,
          product_code,
          name: nameMap.get(product_code) || '(未登録)',
          count_day_stock,
          inbound_qty: agg.inbound_qty,
          outbound_qty: agg.outbound_qty,
          audit_stock_qty,
        }
      })
      .filter((row) => row.inbound_qty > 0 || row.outbound_qty > 0 || row.audit_stock_qty > 0)
      .sort((a, b) => {
        const shelfA = a.shelf_no || ''
        const shelfB = b.shelf_no || ''
        if (shelfA !== shelfB) return shelfA.localeCompare(shelfB, 'ja')
        return a.product_code.localeCompare(b.product_code)
      })

    return NextResponse.json({
      success: true,
      countDate,
      auditDate,
      data,
      count: data.length,
    })
  } catch (error) {
    console.error('棚卸監査帳票APIエラー:', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
