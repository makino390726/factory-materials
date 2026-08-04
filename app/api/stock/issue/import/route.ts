import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import {
  buildProductCodeLookupMap,
  normalizeProductCodeFromExcel,
  resolveProductCode,
} from '@/lib/product-code'
import { ensureCanonicalProductCode } from '@/lib/product-code-migrate'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
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

  // 部分一致（例: 「総計」「出庫総数」）
  for (const name of possibleNames) {
    const key = Object.keys(row).find((k) => String(k).includes(name))
    if (key && row[key] !== undefined && row[key] !== '') {
      return row[key]
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const noteInput = String(formData.get('note') || '').trim()
    const allowNegative = String(formData.get('allow_negative') || '') === '1'

    if (!file) {
      return NextResponse.json({ error: 'ファイルが選択されていません' }, { status: 400 })
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

    let successCount = 0
    let skippedCount = 0
    let errorCount = 0
    const errors: string[] = []
    const codeRemappings: string[] = []
    let totalIssuedQty = 0

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i] as Record<string, unknown>
      const rowNo = i + 2

      try {
        const rawProductCode = getColumnValue(row, [
          '部品コード',
          '商品コード',
          'product_code',
          'code',
          'コード',
          '品番',
        ])
        const productName = getColumnValue(row, [
          '部品名',
          '商品名',
          'product_name',
          'name',
          '品名',
        ])
        const quantity = getColumnValue(row, [
          '総計',
          '総数',
          '出庫総数',
          '出庫数',
          'quantity',
          'qty',
          '数量',
          'total',
        ])

        const importCode = normalizeProductCodeFromExcel(rawProductCode)
        if (!importCode) {
          throw new Error('商品コードが空です')
        }

        const qty = Number(quantity)
        if (!Number.isFinite(qty)) {
          throw new Error('出庫総数が正しくありません')
        }
        if (qty <= 0) {
          skippedCount += 1
          continue
        }

        const { code: resolvedCode } = resolveProductCode(importCode, productCodeLookup)
        const productCodeStr = await ensureCanonicalProductCode(supabase, resolvedCode)

        const rawTrimmed = String(rawProductCode ?? '').trim()
        if (rawTrimmed && productCodeStr !== rawTrimmed) {
          const remapNote = `${rawTrimmed} → ${productCodeStr}`
          if (!codeRemappings.includes(remapNote)) codeRemappings.push(remapNote)
        }

        const { data: productRow } = await supabase
          .from('products')
          .select('id, name')
          .eq('product_code', productCodeStr)
          .maybeSingle()

        if (!productRow) {
          throw new Error(`商品マスタ未登録: ${productCodeStr}`)
        }

        const { data: currentStock } = await supabase
          .from('stocks')
          .select('stock_qty')
          .eq('product_code', productCodeStr)
          .maybeSingle()

        const currentQty = Number(currentStock?.stock_qty || 0)
        const newQty = currentQty - qty

        if (!allowNegative && newQty < 0) {
          throw new Error(
            `在庫不足: 現在庫 ${currentQty} / 出庫 ${qty}（不足 ${Math.abs(newQty)}）`
          )
        }

        const { error: stockError } = await supabase.from('stocks').upsert(
          {
            product_code: productCodeStr,
            stock_qty: newQty,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'product_code' }
        )

        if (stockError) {
          throw new Error(`在庫更新失敗: ${stockError.message}`)
        }

        const nameForNote =
          (productName ? String(productName).trim() : '') ||
          String(productRow.name || '').trim() ||
          productCodeStr
        const note =
          noteInput ||
          `セット品一括出庫: ${nameForNote}`

        const { error: movementError } = await supabase.from('stock_movements').insert({
          product_code: productCodeStr,
          movement: 'OUT',
          qty,
          input_method: 'batch_import',
          note,
          created_at: new Date().toISOString(),
        })

        if (movementError) {
          throw new Error(`履歴記録失敗: ${movementError.message}`)
        }

        successCount += 1
        totalIssuedQty += qty
      } catch (rowError) {
        errorCount += 1
        const errorMsg = rowError instanceof Error ? rowError.message : String(rowError)
        errors.push(`行 ${rowNo}: ${errorMsg}`)
      }
    }

    return NextResponse.json({
      message: '出庫データの一括取込が完了しました',
      total: rawData.length,
      successCount,
      skippedCount,
      errorCount,
      totalIssuedQty,
      codeRemappings: codeRemappings.length > 0 ? codeRemappings.slice(0, 20) : undefined,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
      note: errors.length > 20 ? `他 ${errors.length - 20} 件のエラーがあります` : undefined,
    })
  } catch (error) {
    console.error('出庫一括取込エラー:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'インポート処理に失敗しました',
      },
      { status: 500 }
    )
  }
}
