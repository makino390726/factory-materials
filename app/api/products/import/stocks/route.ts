import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { canonicalizeProductCode } from '@/lib/product-code'
import { ensureCanonicalProductCode } from '@/lib/product-code-migrate'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

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

    console.log('📄 シート名:', sheetName)
    console.log('📊 データ件数:', data.length)
    console.log('🔍 最初の行:', data[0])

    if (data.length === 0) {
      return NextResponse.json(
        { error: 'データが空です' },
        { status: 400 }
      )
    }

    console.log('🧹 既存在庫データを削除中...')
    const { error: deleteError } = await supabase
      .from('stocks')
      .delete()
      .not('product_code', 'is', null)

    if (deleteError) {
      console.error('❌ 在庫削除エラー:', deleteError)
      return NextResponse.json(
        { error: '在庫データの削除に失敗しました', details: deleteError.message },
        { status: 500 }
      )
    }
    console.log('✅ 在庫データ削除完了')

    let successCount = 0
    let errorCount = 0
    const errors: string[] = []
    const debugInfo: Array<{ productCode: string; stockQty: number; result: string }> = []

    // 商品コード正規化（0084007700 → 84007700）
    const normalizeProductCode = (code: string): string => canonicalizeProductCode(code.trim())

    for (const row of data as Record<string, unknown>[]) {
      try {
        // 全カラム名をログ出力
        if (successCount === 0) {
          console.log('📋 Excelカラム名:', Object.keys(row))
        }

        const rawProductCode = String(row['商品コード'] || row['product_code'] || '').trim()
        const productCode = normalizeProductCode(rawProductCode)
        const productName = String(row['商品名'] || row['製品名'] || '').trim()
        const stockQty = Number(row['在庫数'] || row['stock_qty'] || 0)
        const unitPrice = Number(row['当月在庫単価'] || row['unit_price'] || 0)
        const totalAmount = Number(row['在庫金額'] || row['total_amount'] || 0)
        const shelfNo = String(row['棚番'] || row['shelf_no'] || row['shelf'] || '').trim()

        console.log('📦 処理中:', { 
          rawProductCode,
          productCode,
          stockQty, 
          unitPrice, 
          totalAmount
        })

        if (!productCode) {
          errorCount++
          errors.push('商品コードが空です')
          continue
        }

        const productCodeStr = await ensureCanonicalProductCode(supabase, productCode)

        // 商品マスタへ名前を反映（存在しない場合は新規作成）
        if (productName) {
          const { error: productUpsertError } = await supabase
            .from('products')
            .upsert(
              {
                product_code: productCodeStr,
                name: productName,
              },
              { onConflict: 'product_code' }
            )

          if (productUpsertError) {
            throw productUpsertError
          }
        }

        // Upsert: 既存データがあれば更新、なければ挿入
        const { data: resultData, error: upsertError } = await supabase
          .from('stocks')
          .upsert(
            {
              product_code: productCodeStr,
              stock_qty: stockQty,
              unit_price: unitPrice,
              total_amount: totalAmount,
              shelf_no: shelfNo || null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'product_code' }
          )
          .select()

        if (upsertError) {
          throw upsertError
        }

        console.log('✅ 更新後:', resultData?.[0])
        
        debugInfo.push({
          productCode,
          stockQty,
          result: '成功'
        })

        successCount++
      } catch (error) {
        errorCount++
        const errorProductCode = String(row['商品コード'] || row['product_code'] || '不明')
        const errorMessage = error instanceof Error ? error.message : '不明なエラー'
        errors.push(`${errorProductCode}: ${errorMessage}`)
        console.error('❌ 行エラー:', { error, row })
        
        debugInfo.push({
          productCode: errorProductCode,
          stockQty: Number(row['在庫数'] || 0),
          result: `エラー: ${errorMessage}`
        })
      }
    }

    console.log('📈 インポート結果:', { successCount, errorCount })
    console.log('🔍 デバッグ情報:', debugInfo.slice(0, 5))

    return NextResponse.json({
      success: true,
      message: '在庫マスタのインポートが完了しました',
      successCount,
      errorCount,
      errors: errors.slice(0, 10),
      debugInfo: debugInfo.slice(0, 5),
    })
  } catch (error) {
    console.error('在庫マスタインポートエラー:', error)
    return NextResponse.json(
      { error: 'インポート処理に失敗しました', details: error instanceof Error ? error.message : '不明' },
      { status: 500 }
    )
  }
}