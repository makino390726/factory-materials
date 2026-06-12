import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const importType = (formData.get('type') as string) || 'products'

    if (!file) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 400 })
    }

    // ExcelファイルをBufferに変換
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Excelファイルを読み込む
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // JSONに変換
    const data = XLSX.utils.sheet_to_json(worksheet)

    if (importType === 'stocks') {
      return await importStocks(data)
    } else {
      return await importProducts(data)
    }
  } catch (error: any) {
    console.error('インポートエラー:', error)
    return NextResponse.json(
      { error: `インポートに失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}

// 商品マスタインポート
async function importProducts(data: any[]) {
  let successCount = 0
  let errorCount = 0
  const errors: string[] = []

    // データを整形（重複チェック付き）
    const products = []
    const seenCodes = new Set<string>()
    const duplicatesInFile = new Set<string>()
    
    for (let i = 0; i < (data as any[]).length; i++) {
      const row = (data as any[])[i]
      const productData = {
        product_code: String(row['商品コード'] || row['製品コード'] || '').trim(),
        name: String(row['製品名'] || row['商品名'] || '').trim(),
        purchase_price: row['仕入単価'] ? parseFloat(String(row['仕入単価'])) : null,
        cost_price: row['原価'] ? parseFloat(String(row['原価'])) : null,
        barcode: row['バーコード'] || null,
      }

      if (!productData.product_code || !productData.name) {
        errors.push(`スキップ: 商品コードまたは製品名が空 - 行${i + 2}`)
        errorCount++
        continue
      }

      // Excelファイル内の重複検出
      if (seenCodes.has(productData.product_code)) {
        duplicatesInFile.add(productData.product_code)
        errors.push(`⚠️ 重複: ${productData.product_code} - 行${i + 2}（ファイル内で複数回出現）`)
        errorCount++
        continue
      }

      seenCodes.add(productData.product_code)
      products.push(productData)
    }

    // 重複の警告
    if (duplicatesInFile.size > 0) {
      errors.unshift(`⚠️ ファイル内に重複する商品コードが${duplicatesInFile.size}件見つかりました。最初の行のみ処理します。`)
    }

    // バッチ処理（500件ずつ）
    const BATCH_SIZE = 500
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE)
      
      try {
        // upsertで一括処理（既存は更新、新規は登録）
        const { error } = await supabase
          .from('products')
          .upsert(batch, {
            onConflict: 'product_code',
            ignoreDuplicates: false,
          })

        if (error) {
          console.error('バッチエラー:', error)
          errorCount += batch.length
          errors.push(`バッチ${Math.floor(i / BATCH_SIZE) + 1}エラー: ${error.message}`)
        } else {
          successCount += batch.length
        }
      } catch (error: any) {
        errorCount += batch.length
        errors.push(`バッチ${Math.floor(i / BATCH_SIZE) + 1}例外: ${error.message}`)
      }
    }

    return NextResponse.json({
      success: true,
      message: `インポート完了: 成功 ${successCount}件, エラー ${errorCount}件`,
      successCount,
      errorCount,
      errors: errors.slice(0, 10), // 最初の10件のエラーのみ返す
    })
}

// 在庫マスタインポート
async function importStocks(data: any[]) {
  let successCount = 0
  let errorCount = 0
  let skippedCount = 0
  const errors: string[] = []

  // データを整形（重複チェック付き）
  const stocks = []
  const seenCodes = new Set<string>()
  const duplicatesInFile = new Set<string>()
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const stockQtyRaw = row['在庫数'] ? parseFloat(String(row['在庫数'])) : 0
    const unitPriceRaw = row['当月在庫単価'] ?? row['単価'] ?? row['unit_price']
    const totalAmountRaw = row['在庫金額'] ?? row['total_amount']
    const hasUnitPriceInput = !(unitPriceRaw === null || unitPriceRaw === undefined || String(unitPriceRaw).trim() === '')
    const parsedUnitPrice = hasUnitPriceInput
      ? parseFloat(String(unitPriceRaw).replace(/,/g, ''))
      : null
    const hasUnitPrice = hasUnitPriceInput && Number.isFinite(parsedUnitPrice as number)
    const unitPrice = hasUnitPrice ? parsedUnitPrice : null
    const hasTotalAmountInput = !(totalAmountRaw === null || totalAmountRaw === undefined || String(totalAmountRaw).trim() === '')
    const parsedTotalAmount = hasTotalAmountInput
      ? parseFloat(String(totalAmountRaw).replace(/,/g, ''))
      : null
    const hasTotalAmount = hasTotalAmountInput && Number.isFinite(parsedTotalAmount as number)
    const totalAmount = hasTotalAmount ? parsedTotalAmount : null
    const productName = String(row['商品名'] || '').trim() // 商品マスタ登録用
    const stockData = {
      product_code: String(row['商品コード'] || row['製品コード'] || '').trim(),
      stock_qty: stockQtyRaw,
      unit_price: Number.isFinite(unitPrice as number) ? unitPrice : null,
      total_amount: Number.isFinite(totalAmount as number) ? totalAmount : null,
      updated_at: new Date().toISOString(),
    } as any
    // 商品マスタ登録用に名前を別途保持
    stockData._product_name = productName
    stockData._has_unit_price = hasUnitPrice
    stockData._has_total_amount = hasTotalAmount
    // 商品マスタ登録用に名前を別途保持
    ;(stockData as any)._product_name = productName

    if (!stockData.product_code) {
      errors.push(`スキップ: 商品コードが空 - 行${i + 2}`)
      errorCount++
      continue
    }

    // Excelファイル内の重複検出
    if (seenCodes.has(stockData.product_code)) {
      duplicatesInFile.add(stockData.product_code)
      errors.push(`⚠️ 重複: ${stockData.product_code} - 行${i + 2}（ファイル内で複数回出現）`)
      errorCount++
      continue
    }

    seenCodes.add(stockData.product_code)
    stocks.push(stockData)
  }

  // 重複の警告
  if (duplicatesInFile.size > 0) {
    errors.unshift(`⚠️ ファイル内に重複する商品コードが${duplicatesInFile.size}件見つかりました。最初の行のみ処理します。`)
  }

  // 商品マスタに存在する商品コードを取得（全件）
  const { data: existingProducts } = await supabase
    .from('products')
    .select('product_code')
  
  // コードのマッピング（複数形式に対応）
  const codeMap = new Map<string, string>()
  if (existingProducts) {
    for (const p of existingProducts) {
      const normalizedCode = String(p.product_code).trim()
      codeMap.set(normalizedCode, p.product_code)
      // 数値に変換した形式も登録
      try {
        const numCode = String(parseFloat(normalizedCode))
        if (numCode !== normalizedCode) {
          codeMap.set(numCode, p.product_code)
        }
      } catch (e) {}
    }
  }
  
  // 存在しない商品コードを自動登録
  const missingCodes: Array<{code: string; name: string; unitPrice: number | null}> = []
  const validStocks = []
  
  for (const stock of stocks) {
    const normalizedStockCode = String(stock.product_code).trim()
    const stockNumCode = String(parseFloat(normalizedStockCode))
    
    // 複数の形式で検索
    let foundCode: string | null = null
    if (codeMap.has(normalizedStockCode)) {
      foundCode = codeMap.get(normalizedStockCode)!
    } else if (codeMap.has(stockNumCode)) {
      foundCode = codeMap.get(stockNumCode)!
    }
    
    if (!foundCode) {
      // 商品マスタに登録されていない場合、登録対象にする
      missingCodes.push({
        code: stock.product_code,
        name: (stock as any)._product_name || `商品${stock.product_code}`,
        unitPrice: Number.isFinite(Number(stock.unit_price)) ? Number(stock.unit_price) : null,
      })
    } else {
      stock.product_code = foundCode
      validStocks.push(stock)
    }
  }
  
  // 未登録商品をproductsテーブルに追加（重複は無視）
  if (missingCodes.length > 0) {
    const newProducts = missingCodes.map(item => ({
      product_code: item.code,
      name: item.name,
      purchase_price: item.unitPrice,
      cost_price: item.unitPrice,
    }))
    
    try {
      // 重複エラーを無視し、存在しないものだけ追加
      await supabase
        .from('products')
        .upsert(newProducts, { onConflict: 'product_code' })
        .select()
      
      // 登録成功した商品も在庫データに追加
      for (const stock of stocks) {
        if (missingCodes.some(m => m.code === stock.product_code)) {
          validStocks.push(stock)
        }
      }
    } catch (error: any) {
      // 対象外エラーのみ記録
      errors.push(`新規商品登録エラー: ${error.message}`)
    }
  }

  if (validStocks.length === 0) {
    return NextResponse.json({
      success: true,
      message: `処理対象の在庫データがありません（未登録商品 ${skippedCount} 件は無視されました）。`,
      successCount: 0,
      errorCount,
      errors: errors.slice(0, 20),
    })
  }

  // 既存在庫の単価・金額を取得し、ファイルに値が無い場合は既存値を維持する
  const productCodes = Array.from(new Set(validStocks.map((s: any) => String(s.product_code).trim())))
  const { data: existingStocks } = await supabase
    .from('stocks')
    .select('product_code, unit_price, total_amount')
    .in('product_code', productCodes)

  const existingStockMap = new Map<string, { unit_price: number | null; total_amount: number | null }>()
  for (const row of existingStocks || []) {
    existingStockMap.set(String(row.product_code).trim(), {
      unit_price: row.unit_price as number | null,
      total_amount: row.total_amount as number | null,
    })
  }

  // validStocksから_product_nameを削除（Supabaseに送信前）
  const cleanValidStocks = validStocks.map(stock => {
    const existing = existingStockMap.get(String(stock.product_code).trim())
    const clean: any = {
      product_code: stock.product_code,
      stock_qty: stock.stock_qty,
      updated_at: stock.updated_at,
    }

    if (stock._has_unit_price) {
      clean.unit_price = stock.unit_price
    } else if (existing && existing.unit_price !== null && existing.unit_price !== undefined) {
      clean.unit_price = existing.unit_price
    }

    if (stock._has_total_amount) {
      clean.total_amount = stock.total_amount
    } else if (existing && existing.total_amount !== null && existing.total_amount !== undefined) {
      clean.total_amount = existing.total_amount
    }

    delete (clean as any)._product_name
    delete (clean as any)._has_unit_price
    delete (clean as any)._has_total_amount
    return clean
  })

  // 在庫単価がある行は製品マスタの購入価格・原価も同期
  const productPriceRows = Array.from(
    new Map(
      validStocks
        .filter((s: any) => s._has_unit_price && Number.isFinite(Number(s.unit_price)))
        .map((s: any) => [
          String(s.product_code).trim(),
          {
            product_code: String(s.product_code).trim(),
            purchase_price: Number(s.unit_price),
            cost_price: Number(s.unit_price),
          },
        ])
    ).values()
  )

  for (const productRow of productPriceRows) {
    const { error: productUpdateError } = await supabase
      .from('products')
      .update({
        purchase_price: productRow.purchase_price,
        cost_price: productRow.cost_price,
      })
      .eq('product_code', productRow.product_code)

    if (productUpdateError) {
      errors.push(`製品単価更新エラー: ${productRow.product_code} - ${productUpdateError.message}`)
      errorCount++
    }
  }

  // バッチ処理（500件ずつ）
  const BATCH_SIZE = 500
  for (let i = 0; i < cleanValidStocks.length; i += BATCH_SIZE) {
    const batch = cleanValidStocks.slice(i, i + BATCH_SIZE)
    
    try {
      // upsertで一括処理（既存は更新、新規は登録）
      const { error } = await supabase
        .from('stocks')
        .upsert(batch, {
          onConflict: 'product_code',
          ignoreDuplicates: false,
        })

      if (error) {
        console.error('バッチエラー:', error)
        errorCount += batch.length
        errors.push(`バッチ${Math.floor(i / BATCH_SIZE) + 1}エラー: ${error.message}`)
      } else {
        successCount += batch.length
      }
    } catch (error: any) {
      errorCount += batch.length
      errors.push(`バッチ${Math.floor(i / BATCH_SIZE) + 1}例外: ${error.message}`)
    }
  }

  return NextResponse.json({
    success: true,
    message: `在庫インポート完了: 成功 ${successCount}件, エラー ${errorCount}件, 未登録スキップ ${skippedCount}件`,
    successCount,
    errorCount,
    errors: errors.slice(0, 10),
  })
}
