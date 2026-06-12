import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { createJob, finishJob, updateJob } from '../progressStore'

export const runtime = 'nodejs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const normalizeProductCode = (code: string): string => code.trim()
const normalizeHeader = (value: string): string =>
  value.replace(/\s+/g, '').replace(/　/g, '').toLowerCase()

const buildRowMap = (row: Record<string, unknown>) => {
  const map = new Map<string, unknown>()
  for (const [key, value] of Object.entries(row)) {
    map.set(normalizeHeader(key), value)
  }
  return map
}

const getRowValue = (
  row: Record<string, unknown>,
  map: Map<string, unknown>,
  keys: string[]
) => {
  for (const key of keys) {
    if (key in row) return row[key]
    const normalized = normalizeHeader(key)
    if (map.has(normalized)) return map.get(normalized)
  }
  return undefined
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json(
        { error: 'ファイルが選択されていません' },
        { status: 400 }
      )
    }

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(worksheet)

    const jobId = createJob()
    updateJob(jobId, { total: data.length })

    ;(async () => {
      try {
        let successCount = 0
        let errorCount = 0

        console.log('🧹 既存在庫データを削除中...')
        const { error: deleteError } = await supabase
          .from('stocks')
          .delete()
          .not('product_code', 'is', null)

        if (deleteError) {
          console.error('❌ 在庫削除エラー:', deleteError)
          finishJob(jobId, 'error', '在庫データの削除に失敗しました')
          return
        }
        console.log('✅ 在庫データ削除完了')

        const productUpserts: Array<{ product_code: string; name: string }> = []
        const productPriceUpdates: Array<{
          product_code: string
          purchase_price: number
          cost_price: number
        }> = []
        const stockUpserts: Array<{
          product_code: string
          stock_qty: number
          unit_price: number | null
          total_amount: number | null
          shelf_no: string | null
          updated_at: string
          has_unit_price: boolean
          has_total_amount: boolean
        }> = []

        for (let index = 0; index < data.length; index++) {
          const row = data[index] as Record<string, unknown>
          try {
            // デバッグ: 最初の行でカラム名を確認
            if (index === 0) {
              console.log('📋 Excel カラム名:', Object.keys(row))
            }

            const rowMap = buildRowMap(row)

            const rawProductCode = String(
              getRowValue(row, rowMap, ['商品コード', 'product_code']) || ''
            ).trim()
            const productCode = normalizeProductCode(rawProductCode)
            const productName = String(
              getRowValue(row, rowMap, ['商品名', '商品名称', '製品名']) || ''
            ).trim()
            const stockQty = Number(
              getRowValue(row, rowMap, ['在庫数', 'stock_qty']) || 0
            )
            const rawUnitPrice = getRowValue(row, rowMap, ['当月在庫単価', 'unit_price', '単価'])
            const hasUnitPriceInput =
              rawUnitPrice !== undefined &&
              rawUnitPrice !== null &&
              String(rawUnitPrice).trim() !== ''
            const parsedUnitPrice = hasUnitPriceInput ? Number(rawUnitPrice) : null
            const hasUnitPrice = hasUnitPriceInput && Number.isFinite(parsedUnitPrice as number)
            const unitPrice = hasUnitPrice ? parsedUnitPrice : null
            const rawTotalAmount = getRowValue(row, rowMap, ['在庫金額', 'total_amount'])
            const hasTotalAmountInput =
              rawTotalAmount !== undefined &&
              rawTotalAmount !== null &&
              String(rawTotalAmount).trim() !== ''
            const parsedTotalAmount = hasTotalAmountInput ? Number(rawTotalAmount) : null
            const hasTotalAmount = hasTotalAmountInput && Number.isFinite(parsedTotalAmount as number)
            const totalAmount = hasTotalAmount ? parsedTotalAmount : null
            const shelfNo = String(
              getRowValue(row, rowMap, ['棚番', 'shelf_no', 'shelf']) || ''
            ).trim()

            // デバッグ: 最初の3行でデータを確認
            if (index < 3) {
              console.log(`📦 Row ${index}:`, { productCode, productName, stockQty })
            }

            if (!productCode) {
              errorCount++
              updateJob(jobId, { processed: index + 1, successCount, errorCount })
              continue
            }

            if (productName) {
              productUpserts.push({
                product_code: productCode,
                name: productName,
              })
            }

            if (hasUnitPrice && Number.isFinite(unitPrice)) {
              const safeUnitPrice = Number(unitPrice)
              productPriceUpdates.push({
                product_code: productCode,
                purchase_price: safeUnitPrice,
                cost_price: safeUnitPrice,
              })
            }

            stockUpserts.push({
              product_code: productCode,
              stock_qty: stockQty,
              unit_price: unitPrice,
              total_amount: totalAmount,
              shelf_no: shelfNo || null,
              updated_at: new Date().toISOString(),
              has_unit_price: hasUnitPrice,
              has_total_amount: hasTotalAmount,
            })

            successCount++
          } catch {
            errorCount++
          } finally {
            updateJob(jobId, {
              processed: index + 1,
              successCount,
              errorCount,
            })
          }
        }

        const chunk = <T,>(items: T[], size: number) => {
          const result: T[][] = []
          for (let i = 0; i < items.length; i += size) {
            result.push(items.slice(i, i + size))
          }
          return result
        }

        const productChunks = chunk(productUpserts, 500)
        for (const batch of productChunks) {
          if (batch.length === 0) continue
          const { error: productUpsertError } = await supabase
            .from('products')
            .upsert(batch, {
              onConflict: 'product_code',
              ignoreDuplicates: false,
            })

          if (productUpsertError) {
            throw productUpsertError
          }
        }

        const stockCodes = Array.from(new Set(stockUpserts.map((s) => s.product_code)))
        const { data: existingStocks, error: existingStocksError } = await supabase
          .from('stocks')
          .select('product_code, unit_price, total_amount')
          .in('product_code', stockCodes)

        if (existingStocksError) {
          throw existingStocksError
        }

        const existingStockMap = new Map<string, { unit_price: number | null; total_amount: number | null }>()
        for (const row of existingStocks || []) {
          existingStockMap.set(String(row.product_code).trim(), {
            unit_price: row.unit_price as number | null,
            total_amount: row.total_amount as number | null,
          })
        }

        const mergedStockUpserts = stockUpserts.map((row) => {
          const existing = existingStockMap.get(String(row.product_code).trim())
          const merged: any = {
            product_code: row.product_code,
            stock_qty: row.stock_qty,
            shelf_no: row.shelf_no,
            updated_at: row.updated_at,
          }

          if (row.has_unit_price) {
            merged.unit_price = row.unit_price
          } else if (existing && existing.unit_price !== null && existing.unit_price !== undefined) {
            merged.unit_price = existing.unit_price
          }

          if (row.has_total_amount) {
            merged.total_amount = row.total_amount
          } else if (existing && existing.total_amount !== null && existing.total_amount !== undefined) {
            merged.total_amount = existing.total_amount
          }

          return merged
        })

        const productPriceChunks = chunk(productPriceUpdates, 500)
        for (const batch of productPriceChunks) {
          if (batch.length === 0) continue
          for (const row of batch) {
            const { error: productPriceUpdateError } = await supabase
              .from('products')
              .update({
                purchase_price: row.purchase_price,
                cost_price: row.cost_price,
              })
              .eq('product_code', row.product_code)

            if (productPriceUpdateError) {
              throw productPriceUpdateError
            }
          }
        }

        const mergedStockChunks = chunk(mergedStockUpserts, 500)
        for (const batch of mergedStockChunks) {
          if (batch.length === 0) continue
          const { error: upsertError } = await supabase
            .from('stocks')
            .upsert(batch, { onConflict: 'product_code' })

          if (upsertError) {
            throw upsertError
          }
        }

        finishJob(jobId, 'done', '在庫マスタのインポートが完了しました')
      } catch {
        finishJob(jobId, 'error', 'インポート処理に失敗しました')
      }
    })()

    return NextResponse.json({ success: true, jobId })
  } catch (error) {
    return NextResponse.json(
      { error: 'インポート処理に失敗しました' },
      { status: 500 }
    )
  }
}
