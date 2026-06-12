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

    if (!file) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 400 })
    }

    // ExcelまたはCSVファイルをBufferに変換
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // ファイルを読み込む
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // JSONに変換
    const data = XLSX.utils.sheet_to_json(worksheet) as any[]

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'データが見つかりません' }, { status: 400 })
    }

    // カラム名を正規化（トリムして小文字化）
    const normalizedData = data.map(row => {
      const normalizedRow: any = {}
      Object.keys(row).forEach(key => {
        const trimmedKey = key.trim()
        normalizedRow[trimmedKey] = row[key]
      })
      return normalizedRow
    })

    // デバッグ: CSVのヘッダー情報を確認
    const headers = Object.keys(normalizedData[0] || {})
    console.log('CSVヘッダー:', headers)
    console.log('サンプルデータ（1行目）:', normalizedData[0])

    let successCount = 0
    let errorCount = 0
    let notFoundCount = 0
    const errors: string[] = []

    // 全ての部品マスタを一度に取得（高速化）
    const { data: allParts, error: fetchError } = await supabase
      .from('heater_parts_master')
      .select('part_key, product_code')

    if (fetchError) {
      return NextResponse.json(
        { error: `部品マスタの取得に失敗しました: ${fetchError.message}` },
        { status: 500 }
      )
    }

    // 商品コードをキーにしたマップを作成
    const partsMap = new Map(
      (allParts || []).map(part => [part.product_code, part.part_key])
    )

    // 更新データを準備
    const updateData: Array<{ part_key: string; product_code: string; cost_price: number }> = []

    // 各行を処理
    for (let i = 0; i < normalizedData.length; i++) {
      const row = normalizedData[i]
      
      // 商品コードと原価を取得（様々なカラム名に対応）
      let productCode = row['商品コード'] || row['product_code'] || row['コード'] || row['品番'] || row['製品コード'] || row['商品コ ド']
      const costPrice = row['cost_price'] || row['原価'] || row['単価'] || row['price'] || row['仕入単価'] || row['当月在庫単価']

      // 商品コードが数値の場合は文字列に変換
      if (typeof productCode === 'number') {
        productCode = String(productCode)
      }
      
      // 文字列の場合はトリム
      if (typeof productCode === 'string') {
        productCode = productCode.trim()
      }

      if (!productCode) {
        errors.push(`${i + 2}行目: 商品コードが見つかりません`)
        errorCount++
        continue
      }

      if (costPrice === undefined || costPrice === null || costPrice === '') {
        errors.push(`${i + 2}行目: 原価が見つかりません (商品コード: ${productCode})`)
        errorCount++
        continue
      }

      const partKey = partsMap.get(productCode)
      
      if (!partKey) {
        errors.push(`${i + 2}行目: 商品コード ${productCode} が見つかりません`)
        notFoundCount++
        continue
      }

      updateData.push({
        part_key: partKey,
        product_code: productCode,
        cost_price: parseFloat(costPrice)
      })
    }

    // バッチで更新（より高速）
    for (const item of updateData) {
      try {
        const { error: updateError } = await supabase
          .from('heater_parts_master')
          .update({ cost_price: item.cost_price })
          .eq('part_key', item.part_key)

        if (updateError) {
          errors.push(`商品コード ${item.product_code} の更新に失敗 - ${updateError.message}`)
          errorCount++
        } else {
          successCount++
        }
      } catch (error: any) {
        errors.push(`商品コード ${item.product_code} の処理に失敗 - ${error.message}`)
        errorCount++
      }
    }

    return NextResponse.json({
      success: true,
      message: `原価インポート完了`,
      total: normalizedData.length,
      successCount,
      errorCount,
      notFoundCount,
      errors: errors.slice(0, 100), // 最初の100件のエラーのみ返す
      debug: {
        headers,
        sampleRow: normalizedData[0],
        updateDataCount: updateData.length
      }
    })
  } catch (error: any) {
    console.error('インポートエラー:', error)
    return NextResponse.json(
      { error: `インポートに失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}
