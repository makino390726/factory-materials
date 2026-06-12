import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { syncWorkOrderCostItemsForProductCodes } from '@/lib/work-order-cost-from-product-master'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File

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

    return await updateProductPrices(data)
  } catch (error: any) {
    console.error('インポートエラー:', error)
    return NextResponse.json(
      { error: `インポートに失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}

// 製品マスタ単価更新処理
async function updateProductPrices(data: any[]) {
  let successCount = 0
  let updateCount = 0
  let createCount = 0
  let errorCount = 0
  const errors: string[] = []

  // データを整形（重複チェック付き）
  const productsToProcess = []
  const seenCodes = new Set<string>()
  const duplicatesInFile = new Set<string>()

  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    
    // 必須カラムを抽出（複数の表記に対応）
    let productCode = String(row['商品コード'] || row['製品コード'] || row['コード'] || row['product_code'] || '').trim()
    const productName = String(row['商品名'] || row['製品名'] || row['name'] || '').trim()
    const unitPrice = row['単価'] || row['仕入単価'] || row['purchase_price'] || row['price']

    // Excelで数値として読み込まれた場合の対応
    if (typeof productCode === 'number') {
      productCode = String(productCode)
    }
    
    console.log(`行${i + 2}: コード="${productCode}", 名前="${productName}", 単価="${unitPrice}"`)

    // 商品コードが空の場合はスキップ
    if (!productCode) {
      errors.push(`スキップ: 商品コードが空 - 行${i + 2}`)
      errorCount++
      continue
    }

    // 単価が空または0の場合もスキップ
    if (unitPrice === null || unitPrice === undefined || unitPrice === '') {
      errors.push(`スキップ: 単価が空 - 商品コード${productCode}（行${i + 2}）`)
      errorCount++
      continue
    }

    const parsedPrice = parseFloat(String(unitPrice))
    if (isNaN(parsedPrice)) {
      errors.push(`スキップ: 単価が数値ではない - 商品コード${productCode}（行${i + 2}）`)
      errorCount++
      continue
    }

    // Excelファイル内の重複検出
    if (seenCodes.has(productCode)) {
      duplicatesInFile.add(productCode)
      errors.push(`⚠️ 重複: ${productCode} - 行${i + 2}（ファイル内で複数回出現）`)
      errorCount++
      continue
    }

    seenCodes.add(productCode)
    productsToProcess.push({
      product_code: productCode,
      name: productName,
      purchase_price: parsedPrice,
      cost_price: parsedPrice,
    })
  }

  // 重複の警告
  if (duplicatesInFile.size > 0) {
    errors.unshift(`⚠️ ファイル内に重複する商品コードが${duplicatesInFile.size}件見つかりました。最初の行のみ処理します。`)
  }

  // データベースに既存の商品を取得
  const { data: existingProducts, error: fetchError } = await supabase
    .from('products')
    .select('id, product_code')

  if (fetchError) {
    return NextResponse.json(
      { error: `既存製品の取得に失敗しました: ${fetchError.message}` },
      { status: 500 }
    )
  }

  // 複数の形式でマッピング（数値、ゼロパディング、スペース除去など）
  const existingProductMap = new Map<string, string>()
  if (existingProducts) {
    for (const p of existingProducts) {
      const code = String(p.product_code || '').trim()
      
      // パターン1: そのままのコード
      existingProductMap.set(code, code)
      
      // パターン2: 大文字小文字を無視
      existingProductMap.set(code.toUpperCase(), code)
      existingProductMap.set(code.toLowerCase(), code)
      
      // パターン3: ハイフンを除去
      existingProductMap.set(code.replace(/-/g, ''), code)
      
      // パターン4: 数値として読み込まれた場合：先頭ゼロを除去したもの
      // 例："001" → "1"
      try {
        const numValue = parseInt(code, 10)
        if (!isNaN(numValue)) {
          existingProductMap.set(String(numValue), code)
        }
      } catch (e) {}
    }
  }
  
  console.log('既存商品数:', existingProducts?.length || 0)
  console.log('既存商品マップサイズ:', existingProductMap.size)
  console.log('処理対象商品数:', productsToProcess.length)
  if (existingProducts && existingProducts.length > 0) {
    console.log('既存商品コードサンプル:', existingProducts.slice(0, 5).map(p => p.product_code))
  }

  // 更新と新規登録に分類
  const productsToUpdate = []
  const productsToCreate = []

  for (const product of productsToProcess) {
    let matched = false
    let matchedCode = ''
    
    // 複数の形式で既存商品を検索
    const searchPatterns = [
      String(product.product_code).trim(),
      String(product.product_code).trim().toUpperCase(),
      String(product.product_code).trim().toLowerCase(),
      String(product.product_code).trim().replace(/-/g, ''),
    ]
    
    // 数値形式でも検索
    try {
      const numValue = parseInt(String(product.product_code).trim(), 10)
      if (!isNaN(numValue)) {
        searchPatterns.push(String(numValue))
      }
    } catch (e) {}
    
    // 最初にマッチしたパターンで更新対象にする
    for (const pattern of searchPatterns) {
      if (existingProductMap.has(pattern)) {
        matchedCode = existingProductMap.get(pattern)!
        product.product_code = matchedCode
        matched = true
        console.log(`マッチ: "${String(product.product_code).trim()}" → "${matchedCode}"`)
        break
      }
    }
    
    if (matched) {
      productsToUpdate.push(product)
    } else {
      productsToCreate.push(product)
    }
  }

  console.log('更新対象:', productsToUpdate.length)
  console.log('新規登録対象:', productsToCreate.length)
  if (productsToUpdate.length > 0) {
    console.log('更新対象コードサンプル:', productsToUpdate.slice(0, 5).map(p => p.product_code))
  }
  if (productsToCreate.length > 0) {
    console.log('新規登録対象コードサンプル:', productsToCreate.slice(0, 5).map(p => p.product_code))
  }

  // 既存製品の単価更新（バッチ処理）
  if (productsToUpdate.length > 0) {
    const BATCH_SIZE = 500
    for (let i = 0; i < productsToUpdate.length; i += BATCH_SIZE) {
      const batch = productsToUpdate.slice(i, i + BATCH_SIZE)

      try {
        // 各商品を個別に更新
        for (const product of batch) {
          const { error: updateError } = await supabase
            .from('products')
            .update({
              purchase_price: product.purchase_price,
              cost_price: product.cost_price,
            })
            .eq('product_code', String(product.product_code).trim())

          if (updateError) {
            console.error(`更新エラー (${product.product_code}):`, updateError)
            errors.push(`更新エラー: ${product.product_code} - ${updateError.message}`)
            errorCount++
          } else {
            updateCount++
            successCount++
          }
        }
      } catch (error: any) {
        console.error(`バッチ${Math.floor(i / BATCH_SIZE) + 1}例外:`, error)
        errors.push(`更新バッチ${Math.floor(i / BATCH_SIZE) + 1}例外: ${error.message}`)
        errorCount += batch.length
      }
    }
  }

  // 新規製品を登録（upsertで既存は無視、重複エラーを回避）
  if (productsToCreate.length > 0) {
    const BATCH_SIZE = 500
    for (let i = 0; i < productsToCreate.length; i += BATCH_SIZE) {
      const batch = productsToCreate.slice(i, i + BATCH_SIZE)

      try {
        const insertData = batch.map(product => ({
          product_code: String(product.product_code).trim(),
          name: String(product.name || `商品${product.product_code}`).trim(),
          purchase_price: product.purchase_price,
          cost_price: product.cost_price,
        }))
        
        console.log(`バッチ${Math.floor(i / BATCH_SIZE) + 1}の挿入データ数:`, insertData.length)
        
        // upsertを使用：既存は無視、新規のみ追加
        const { error: insertError } = await supabase
          .from('products')
          .upsert(insertData, {
            onConflict: 'product_code',
            ignoreDuplicates: true,
          })

        if (insertError) {
          console.error('一括登録エラー:', insertError)
          errors.push(`新規登録エラー: ${insertError.message}`)
          errorCount += batch.length
        } else {
          createCount += batch.length
          successCount += batch.length
        }
      } catch (error: any) {
        console.error(`新規登録バッチ${Math.floor(i / BATCH_SIZE) + 1}例外:`, error)
        errors.push(`新規登録バッチ${Math.floor(i / BATCH_SIZE) + 1}例外: ${error.message}`)
        errorCount += batch.length
      }
    }
  }

  const codesForSync = Array.from(
    new Set(
      [...productsToUpdate, ...productsToCreate]
        .map((p) => String(p.product_code || '').trim())
        .filter(Boolean)
    )
  )
  let work_order_cost_sync: Record<string, unknown> = { ok: true, updated: 0 }
  if (codesForSync.length > 0) {
    try {
      work_order_cost_sync = {
        ok: true,
        ...(await syncWorkOrderCostItemsForProductCodes(supabase, codesForSync)),
      }
    } catch (syncErr) {
      console.error('原価明細同期エラー（単価インポート後）:', syncErr)
      work_order_cost_sync = {
        ok: false,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      }
    }
  }

  return NextResponse.json({
    success: true,
    message: `処理完了: 成功 ${successCount}件 (更新 ${updateCount}件、新規 ${createCount}件)${errorCount > 0 ? `, エラー ${errorCount}件` : ''}`,
    successCount,
    updateCount,
    createCount,
    errorCount,
    errors: errors.slice(0, 20), // 最初の20件のエラーのみ返す
    work_order_cost_sync,
  })
}
