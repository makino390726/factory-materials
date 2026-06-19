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

    // ExcelファイルをBufferに変換
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Excelファイルを読み込む
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // JSONに変換
    const rawData = XLSX.utils.sheet_to_json(worksheet)

    return await importWorkOrders(rawData)
  } catch (error: any) {
    console.error('インポートエラー:', error)
    return NextResponse.json(
      { error: `インポートに失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}

async function importWorkOrders(rawData: any[]) {
  const errors: string[] = []
  const workOrders: any[] = []

  // バリデーション
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i]
    const rowNum = i + 2

    const orderNo = String(
      row['D指令番号'] ||
        row['作業指令番号'] ||
        row['order_no'] ||
        ''
    ).trim()
    const productName = String(row['製品名'] || row['product_name'] || '').trim()
    const model = String(
      row['型式'] ||
      row['model'] ||
      row['code_type'] ||
      row['コード種別'] ||
      row['コードタイプ'] ||
      ''
    ).trim()
    const workContent = String(row['作業内容'] || row['work_content'] || '').trim()
    const qtyRaw = String(row['数量'] || row['qty'] || '').trim()
    const status = String(row['ステータス'] || row['status'] || '').trim()

    // 必須フィールド検証
    if (!orderNo) {
      errors.push(`行${rowNum}: D指令番号が未入力`)
      continue
    }

    // 数量の検証（整数値、0以上）
    const qty = qtyRaw ? parseInt(qtyRaw, 10) : null
    if (qtyRaw && (isNaN(qty!) || qty! < 0)) {
      errors.push(`行${rowNum}: 数量が無効な値 (${qtyRaw})`)
      continue
    }

    // ステータスの検証（入力されている場合のみ）
    const validStatuses = ['未開始', '進行中', '完了', '保留', 'その他']
    if (status && !validStatuses.includes(status)) {
      errors.push(
        `行${rowNum}: ステータスが無効 (${status}) - 有効値: ${validStatuses.join(', ')}`
      )
      continue
    }

    workOrders.push({
      order_no: orderNo,
      product_name: productName || null,
      model: model || null,
      work_content: workContent || null,
      qty: qtyRaw ? qty : null,
      status: status || null,
      completed: false,
    })
  }

  // エラーが多い場合は全体中止
  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'バリデーションエラーのため、インポートを中止しました',
        errorCount: errors.length,
        errors: errors.slice(0, 20), // 最初の20件
      },
      { status: 400 }
    )
  }

  if (workOrders.length === 0) {
    return NextResponse.json(
      { error: 'インポートするデータがありません' },
      { status: 400 }
    )
  }

  // NOTE: allow duplicate order_no to support same D指令番号 with different 型式.
  // 以前は既存の order_no をチェックして重複を拒否していたが、要件で
  // 同一D指令番号の複数登録を許可するためこのチェックを省略する。

  // トランザクション処理：全件一括挿入
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .insert(workOrders)

    if (error) {
      if (error.code === '23505' && String(error.message || '').includes('work_orders_order_no_key')) {
        return NextResponse.json(
          {
            error:
              'DB制約が旧仕様のため、同一D指令番号を登録できません。`order_no + model(=code_type)` の複合ユニーク制約へ移行してください。',
          },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: `挿入に失敗しました: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `${workOrders.length}件のD指令をインポートしました`,
      importCount: workOrders.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: `インポート処理に失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}
