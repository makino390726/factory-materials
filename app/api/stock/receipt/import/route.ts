import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import {
  buildProductCodeLookupMap,
  normalizeProductCodeFromExcel,
  registerProductCode,
  resolveProductCode,
} from '@/lib/product-code'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json('error: ファイルが選択されていません', { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' })

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return NextResponse.json({ error: 'ファイルが空です' }, { status: 400 })
    }

    const { data: existingProducts, error: productsFetchError } = await supabase
      .from('products')
      .select('product_code')

    if (productsFetchError) {
      return NextResponse.json(
        { error: `既存商品の取得に失敗しました: ${productsFetchError.message}` },
        { status: 500 }
      )
    }

    const productCodeLookup = buildProductCodeLookupMap(
      (existingProducts || []).map((p) => String(p.product_code || ''))
    )

    const getColumnValue = (row: Record<string, unknown>, possibleNames: string[]): unknown => {
      for (const name of possibleNames) {
        if (row[name] !== undefined && row[name] !== '') {
          return row[name]
        }
        const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase())
        if (key && row[key] !== undefined && row[key] !== '') {
          return row[key]
        }
      }
      return null
    }

    let successCount = 0
    let errorCount = 0
    const errors: string[] = []
    const codeRemappings: string[] = []

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i] as Record<string, unknown>

      try {
        const receiptDate = getColumnValue(row, [
          '入荷日付',
          'receipt_date',
          '受取日',
          '入荷日',
          'date',
        ])
        const rawProductCode = getColumnValue(row, [
          '商品コード',
          'product_code',
          'code',
          'コード',
          '品番',
        ])
        const productName = getColumnValue(row, ['商品名', 'product_name', 'name', '名前'])
        const quantity = getColumnValue(row, [
          '総数',
          '入荷数',
          'quantity',
          'qty',
          '数量',
          'total',
        ])
        const unitPrice = getColumnValue(row, ['単価', 'unit_price', 'price', '価格', 'cost'])

        const importCode = normalizeProductCodeFromExcel(rawProductCode)
        if (!importCode) {
          throw new Error('商品コードが空です')
        }

        const qty = Number(quantity)
        if (isNaN(qty) || qty <= 0) {
          throw new Error('入荷数が正しくありません')
        }

        const price = unitPrice !== null && unitPrice !== undefined && unitPrice !== ''
          ? Number(unitPrice)
          : null
        if (price !== null && isNaN(price)) {
          throw new Error('単価が正しくありません')
        }

        const { code: productCodeStr, isExisting } = resolveProductCode(importCode, productCodeLookup)
        if (importCode !== productCodeStr && isExisting) {
          const remapNote = `${importCode} → ${productCodeStr}`
          if (!codeRemappings.includes(remapNote)) {
            codeRemappings.push(remapNote)
          }
        }

        if (!isExisting) {
          const { error: productError } = await supabase.from('products').insert({
            product_code: productCodeStr,
            name: productName ? String(productName).trim() : productCodeStr,
            purchase_price: price,
            cost_price: price,
          })

          if (productError) {
            throw new Error(`商品作成失敗: ${productError.message}`)
          }

          registerProductCode(productCodeLookup, productCodeStr)
        } else if (price !== null) {
          const { error: productPriceUpdateError } = await supabase
            .from('products')
            .update({
              purchase_price: price,
              cost_price: price,
            })
            .eq('product_code', productCodeStr)

          if (productPriceUpdateError) {
            throw new Error(`商品単価更新失敗: ${productPriceUpdateError.message}`)
          }
        }

        const { data: currentStock } = await supabase
          .from('stocks')
          .select('stock_qty, unit_price')
          .eq('product_code', productCodeStr)
          .maybeSingle()

        const currentQty = currentStock?.stock_qty || 0

        const updateData: Record<string, unknown> = {
          product_code: productCodeStr,
          stock_qty: currentQty + qty,
          updated_at: new Date().toISOString(),
        }

        if (price !== null) {
          updateData.unit_price = price
        }

        const { error: stockError } = await supabase
          .from('stocks')
          .upsert(updateData, { onConflict: 'product_code' })

        if (stockError) {
          throw new Error(`在庫更新失敗: ${stockError.message}`)
        }

        let receiptDateIso: string
        if (receiptDate) {
          let dateObj: Date
          if (receiptDate instanceof Date) {
            dateObj = receiptDate
          } else if (typeof receiptDate === 'number') {
            const excelEpoch = new Date(1900, 0, 1)
            dateObj = new Date(excelEpoch.getTime() + (receiptDate - 1) * 86400 * 1000)
          } else if (typeof receiptDate === 'string') {
            dateObj = new Date(receiptDate)
            if (isNaN(dateObj.getTime())) {
              const match = receiptDate.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
              if (match) {
                dateObj = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
              }
            }
          } else {
            dateObj = new Date()
          }
          receiptDateIso = isNaN(dateObj.getTime()) ? new Date().toISOString() : dateObj.toISOString()
        } else {
          receiptDateIso = new Date().toISOString()
        }

        const { error: movementError } = await supabase.from('stock_movements').insert({
          product_code: productCodeStr,
          movement: 'IN',
          qty: qty,
          input_method: 'batch_import',
          note: productName ? `商品データとり込み: ${String(productName).trim()}` : null,
          created_at: receiptDateIso,
        })

        if (movementError) {
          throw new Error(`履歴記録失敗: ${movementError.message}`)
        }

        successCount += 1
      } catch (rowError) {
        errorCount += 1
        const errorMsg = rowError instanceof Error ? rowError.message : String(rowError)
        errors.push(`行 ${i + 2}: ${errorMsg}`)
      }
    }

    return NextResponse.json({
      message: `入庫データの取込が完了しました`,
      total: rawData.length,
      successCount,
      errorCount,
      codeRemappings: codeRemappings.length > 0 ? codeRemappings.slice(0, 20) : undefined,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      note: errors.length > 10 ? `他 ${errors.length - 10} 件のエラーがあります` : undefined,
    })
  } catch (error) {
    console.error('インポートエラー:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'インポート処理に失敗しました',
      },
      { status: 500 }
    )
  }
}
