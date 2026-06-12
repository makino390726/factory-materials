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
    const importType = formData.get('type') as string

    if (!file) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 400 })
    }

    if (!importType) {
      return NextResponse.json({ error: 'インポート種別が指定されていません' }, { status: 400 })
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

    // インポートタイプに応じて処理を分岐
    switch (importType) {
      case 'work-orders':
        return await importWorkOrders(rawData)
      case 'machines':
        return await importMachines(rawData)
      case 'work-contents':
        return await importWorkContents(rawData)
      case 'lines':
        return await importLines(rawData)
      default:
        return NextResponse.json({ error: '無効なインポート種別です' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('インポートエラー:', error)
    return NextResponse.json(
      { error: `インポートに失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}

// 作業指令インポート
async function importWorkOrders(rawData: any[]) {
  const errors: string[] = []
  const workOrders: any[] = []

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i]
    const rowNum = i + 2

    const orderNo = String(row['作業指令番号'] || row['order_no'] || '').trim()
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

    if (!orderNo) {
      errors.push(`行${rowNum}: 作業指令番号が未入力`)
      continue
    }

    const qty = qtyRaw ? parseInt(qtyRaw, 10) : null
    if (qtyRaw && (isNaN(qty!) || qty! < 0)) {
      errors.push(`行${rowNum}: 数量が無効な値 (${qtyRaw})`)
      continue
    }

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

  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'バリデーションエラーのため、インポートを中止しました',
        errorCount: errors.length,
        errors: errors.slice(0, 20),
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

  const orderNos = [...new Set(workOrders.map((w) => w.order_no))]
  const { data: existingOrders, error: fetchError } = await supabase
    .from('work_orders')
    .select('order_no, model')
    .in('order_no', orderNos)

  if (fetchError) {
    return NextResponse.json(
      { error: `既存データ確認に失敗: ${fetchError.message}` },
      { status: 500 }
    )
  }

  const buildCompositeKey = (orderNo: string, model: string | null) =>
    `${String(orderNo || '').trim()}::${String(model || '').trim()}`

  const existingOrderKeys = new Set(
    (existingOrders || []).map((o) => buildCompositeKey(o.order_no, o.model))
  )
  const conflicts = workOrders.filter((w) =>
    existingOrderKeys.has(buildCompositeKey(w.order_no, w.model))
  )

  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `重複する作業指令(指令番号+型式)が見つかりました: ${conflicts
          .map((c) => `${c.order_no}${c.model ? `(${c.model})` : '(型式なし)'}`)
          .join(', ')}`,
        errorCount: conflicts.length,
      },
      { status: 400 }
    )
  }

  try {
    const { error } = await supabase.from('work_orders').insert(workOrders)

    if (error) {
      return NextResponse.json(
        { error: `挿入に失敗しました: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `${workOrders.length}件の作業指令をインポートしました`,
      importCount: workOrders.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: `インポート処理に失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}

// 機械設備分類インポート
async function importMachines(rawData: any[]) {
  const errors: string[] = []
  const machines: any[] = []

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i]
    const rowNum = i + 2

    const workGroupCode = String(row['作業グループコード'] || row['work_group_code'] || '').trim()
    const categoryCodeRaw = String(row['カテゴリコード'] || row['category_code'] || '').trim()
    const categoryName = String(row['カテゴリ名'] || row['category_name'] || '').trim()

    if (!workGroupCode) {
      errors.push(`行${rowNum}: 作業グループコードが未入力`)
      continue
    }

    if (!categoryCodeRaw) {
      errors.push(`行${rowNum}: カテゴリコードが未入力`)
      continue
    }

    if (!categoryName) {
      errors.push(`行${rowNum}: カテゴリ名が未入力`)
      continue
    }

    const categoryCode = parseInt(categoryCodeRaw, 10)
    if (isNaN(categoryCode)) {
      errors.push(`行${rowNum}: カテゴリコードが無効な値 (${categoryCodeRaw})`)
      continue
    }

    machines.push({
      work_group_code: workGroupCode,
      category_code: categoryCode,
      category_name: categoryName,
    })
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'バリデーションエラーのため、インポートを中止しました',
        errorCount: errors.length,
        errors: errors.slice(0, 20),
      },
      { status: 400 }
    )
  }

  if (machines.length === 0) {
    return NextResponse.json(
      { error: 'インポートするデータがありません' },
      { status: 400 }
    )
  }

  // 重複チェック（work_group_code + category_codeの組み合わせ）
  const checkKeys = machines.map((m) => `${m.work_group_code}-${m.category_code}`)
  const { data: existingMachines, error: fetchError } = await supabase
    .from('machines')
    .select('work_group_code, category_code')

  if (fetchError) {
    return NextResponse.json(
      { error: `既存データ確認に失敗: ${fetchError.message}` },
      { status: 500 }
    )
  }

  const existingKeys = new Set(
    (existingMachines || []).map((m) => `${m.work_group_code}-${m.category_code}`)
  )
  const conflicts = machines.filter((m) =>
    existingKeys.has(`${m.work_group_code}-${m.category_code}`)
  )

  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `重複する組み合わせが見つかりました: ${conflicts
          .map((c) => `${c.work_group_code}-${c.category_code}`)
          .join(', ')}`,
        errorCount: conflicts.length,
      },
      { status: 400 }
    )
  }

  try {
    const { error } = await supabase.from('machines').insert(machines)

    if (error) {
      return NextResponse.json(
        { error: `挿入に失敗しました: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `${machines.length}件の機械設備分類をインポートしました`,
      importCount: machines.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: `インポート処理に失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}

// 作業内容マスタインポート
async function importWorkContents(rawData: any[]) {
  const errors: string[] = []
  const workContents: any[] = []

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i]
    const rowNum = i + 2

    const workGroupCode = String(row['作業グループコード'] || row['work_group_code'] || '').trim()
    const workCode = String(row['作業コード'] || row['work_code'] || '').trim()
    const workName = String(row['作業名'] || row['work_name'] || '').trim()
    const printType = String(
      row['印刷種別'] || row['print_type'] || row['rrint_type'] || ''
    ).trim()

    if (!workGroupCode) {
      errors.push(`行${rowNum}: 作業グループコードが未入力`)
      continue
    }

    if (!workCode) {
      errors.push(`行${rowNum}: 作業コードが未入力`)
      continue
    }

    if (!workName) {
      errors.push(`行${rowNum}: 作業名が未入力`)
      continue
    }

    if (!printType) {
      errors.push(`行${rowNum}: 印刷種別が未入力`)
      continue
    }

    workContents.push({
      work_group_code: workGroupCode,
      work_code: workCode,
      work_name: workName,
      print_type: printType,
    })
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'バリデーションエラーのため、インポートを中止しました',
        errorCount: errors.length,
        errors: errors.slice(0, 20),
      },
      { status: 400 }
    )
  }

  if (workContents.length === 0) {
    return NextResponse.json(
      { error: 'インポートするデータがありません' },
      { status: 400 }
    )
  }

  const { data: existingWorkContents, error: fetchError } = await supabase
    .from('work_contents')
    .select('work_group_code, work_code')

  if (fetchError) {
    return NextResponse.json(
      { error: `既存データ確認に失敗: ${fetchError.message}` },
      { status: 500 }
    )
  }

  const existingKeys = new Set(
    (existingWorkContents || []).map(
      (w) => `${w.work_group_code}-${w.work_code}`
    )
  )
  const conflicts = workContents.filter((w) =>
    existingKeys.has(`${w.work_group_code}-${w.work_code}`)
  )

  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `重複する組み合わせが見つかりました: ${conflicts
          .map((c) => `${c.work_group_code}-${c.work_code}`)
          .join(', ')}`,
        errorCount: conflicts.length,
      },
      { status: 400 }
    )
  }

  try {
    const { error } = await supabase.from('work_contents').insert(workContents)

    if (error) {
      return NextResponse.json(
        { error: `挿入に失敗しました: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `${workContents.length}件の作業内容をインポートしました`,
      importCount: workContents.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: `インポート処理に失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}

// ラインマスタインポート
async function importLines(rawData: any[]) {
  const errors: string[] = []
  const lines: any[] = []

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i]
    const rowNum = i + 2

    const lineCode = String(row['ラインコード'] || row['line_code'] || '').trim()
    const lineName = String(row['ライン名'] || row['line_name'] || row['name'] || '').trim()
    const sortOrderRaw = String(row['表示順'] || row['sort_order'] || '').trim()
    const isActiveRaw = String(row['有効'] || row['is_active'] || '').trim()

    if (!lineCode) {
      errors.push(`行${rowNum}: ラインコードが未入力`)
      continue
    }

    if (!lineName) {
      errors.push(`行${rowNum}: ライン名が未入力`)
      continue
    }

    const sortOrder = sortOrderRaw ? parseInt(sortOrderRaw, 10) : 0
    if (sortOrderRaw && isNaN(sortOrder)) {
      errors.push(`行${rowNum}: 表示順が無効な値 (${sortOrderRaw})`)
      continue
    }

    let isActive = true
    if (isActiveRaw) {
      const activeStr = isActiveRaw.toLowerCase()
      if (['true', '1', 'はい', '有効', 'yes'].includes(activeStr)) {
        isActive = true
      } else if (['false', '0', 'いいえ', '無効', 'no'].includes(activeStr)) {
        isActive = false
      }
    }

    lines.push({
      line_code: lineCode,
      name: lineName,
      sort_order: sortOrder,
      is_active: isActive,
    })
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'バリデーションエラーのため、インポートを中止しました',
        errorCount: errors.length,
        errors: errors.slice(0, 20),
      },
      { status: 400 }
    )
  }

  if (lines.length === 0) {
    return NextResponse.json(
      { error: 'インポートするデータがありません' },
      { status: 400 }
    )
  }

  const lineCodes = lines.map((l) => l.line_code)
  const { data: existingLines, error: fetchError } = await supabase
    .from('lines')
    .select('line_code')
    .in('line_code', lineCodes)

  if (fetchError) {
    return NextResponse.json(
      { error: `既存データ確認に失敗: ${fetchError.message}` },
      { status: 500 }
    )
  }

  const existingCodes = new Set((existingLines || []).map((l) => l.line_code))
  const conflicts = lines.filter((l) => existingCodes.has(l.line_code))

  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `重複するラインコードが見つかりました: ${conflicts.map((c) => c.line_code).join(', ')}`,
        errorCount: conflicts.length,
      },
      { status: 400 }
    )
  }

  try {
    const { error } = await supabase.from('lines').insert(lines)

    if (error) {
      return NextResponse.json(
        { error: `挿入に失敗しました: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `${lines.length}件のラインをインポートしました`,
      importCount: lines.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: `インポート処理に失敗しました: ${error.message}` },
      { status: 500 }
    )
  }
}
