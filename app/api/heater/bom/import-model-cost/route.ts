import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type NormalizedRow = {
  model: string
  part_key: string
  part_name: string
  product_code: string | null
  spec: string | null
  quantity: number
  cost_price: number | null
}

function pickCell(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key]
    }
  }
  // case-insensitive / trimmed key match
  const entries = Object.entries(row)
  for (const key of keys) {
    const found = entries.find(([k]) => k.trim().toLowerCase() === key.trim().toLowerCase())
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') {
      return found[1]
    }
  }
  return undefined
}

function toText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function normalizeRows(
  data: Record<string, unknown>[],
  defaultModel: string
): { rows: NormalizedRow[]; errors: string[] } {
  const rows: NormalizedRow[] = []
  const errors: string[] = []

  for (let i = 0; i < data.length; i++) {
    const raw = data[i]
    const lineNo = i + 2
    const model = toText(
      pickCell(raw, ['機種', '機種コード', 'model', 'Model', '製品機種'])
    ) || defaultModel
    const partKey = toText(
      pickCell(raw, ['部品キー', 'part_key', 'パーツキー', '図番', 'drawing', 'Drawing'])
    )
    const partName = toText(
      pickCell(raw, ['品名', '部品名', 'part_name', 'name', '名称'])
    )
    const productCode = toText(
      pickCell(raw, ['製品コード', '商品コード', 'product_code', '品番', 'コード'])
    ) || null
    const spec = toText(pickCell(raw, ['規格', 'spec', '仕様'])) || null
    const quantity = toNumber(pickCell(raw, ['数量', '必要数', 'quantity', 'qty', '1台当たり必要数']))
    const costPrice = toNumber(
      pickCell(raw, ['単価', '原価', '原価単価', 'cost_price', 'unit_cost', '仕入単価'])
    )

    if (!model) {
      errors.push(`${lineNo}行目: 機種がありません（画面で機種選択するか、Excelに機種列を入れてください）`)
      continue
    }
    if (!partKey) {
      errors.push(`${lineNo}行目: 部品キーがありません`)
      continue
    }
    if (!partName) {
      errors.push(`${lineNo}行目: 品名がありません（部品キー: ${partKey}）`)
      continue
    }

    rows.push({
      model,
      part_key: partKey,
      part_name: partName,
      product_code: productCode,
      spec,
      quantity: quantity == null || quantity < 0 ? 1 : quantity,
      cost_price: costPrice,
    })
  }

  return { rows, errors }
}

/**
 * POST /api/heater/bom/import-model-cost
 * form-data:
 *   file: Excel/CSV
 *   model?: 画面で選択中の機種（Excelに機種列がない場合の既定値）
 *
 * Excel想定列:
 *   機種, 部品キー, 品名, 製品コード, 規格, 数量, 単価
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const defaultModel = String(formData.get('model') || '').trim()

    if (!file) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return NextResponse.json({ error: 'シートが見つかりません' }, { status: 400 })
    }
    const worksheet = workbook.Sheets[sheetName]
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, unknown>[]
    if (!rawData.length) {
      return NextResponse.json({ error: 'データ行がありません' }, { status: 400 })
    }

    const normalizedData = rawData.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        out[String(k).trim()] = v
      }
      return out
    })

    const { rows, errors } = normalizeRows(normalizedData, defaultModel)
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: '取込可能な行がありません',
          errors: errors.slice(0, 50),
          headers: Object.keys(normalizedData[0] || {}),
        },
        { status: 400 }
      )
    }

    let partsCreated = 0
    let partsUpdated = 0
    let bomCreated = 0
    let bomUpdated = 0
    const rowErrors = [...errors]

    // 既存パーツキーを取得
    const uniquePartKeys = [...new Set(rows.map((r) => r.part_key))]
    const existingPartKeys = new Set<string>()
    for (let i = 0; i < uniquePartKeys.length; i += 200) {
      const chunk = uniquePartKeys.slice(i, i + 200)
      const { data, error } = await supabase
        .from('heater_parts_master')
        .select('part_key')
        .in('part_key', chunk)
      if (error) throw error
      for (const p of data || []) existingPartKeys.add(String(p.part_key))
    }

    for (const row of rows) {
      try {
        if (existingPartKeys.has(row.part_key)) {
          const updatePayload: Record<string, unknown> = {
            part_name: row.part_name,
            product_code: row.product_code,
            spec: row.spec,
          }
          if (row.cost_price != null) updatePayload.cost_price = row.cost_price
          const { error } = await supabase
            .from('heater_parts_master')
            .update(updatePayload)
            .eq('part_key', row.part_key)
          if (error) throw error
          partsUpdated++
        } else {
          const { error } = await supabase.from('heater_parts_master').insert([
            {
              part_key: row.part_key,
              part_name: row.part_name,
              product_code: row.product_code,
              spec: row.spec,
              cost_price: row.cost_price ?? 0,
              shelf_no: null,
            },
          ])
          if (error) throw error
          existingPartKeys.add(row.part_key)
          partsCreated++
        }

        const { data: existingBom, error: bomFindError } = await supabase
          .from('heater_bom')
          .select('model, part_key')
          .eq('model', row.model)
          .eq('part_key', row.part_key)
          .maybeSingle()
        if (bomFindError) throw bomFindError

        if (existingBom) {
          const { error } = await supabase
            .from('heater_bom')
            .update({ quantity: row.quantity })
            .eq('model', row.model)
            .eq('part_key', row.part_key)
          if (error) throw error
          bomUpdated++
        } else {
          const { error } = await supabase.from('heater_bom').insert([
            {
              model: row.model,
              part_key: row.part_key,
              quantity: row.quantity,
            },
          ])
          if (error) throw error
          bomCreated++
        }
      } catch (e) {
        rowErrors.push(
          `${row.model}/${row.part_key}: ${e instanceof Error ? e.message : '処理に失敗しました'}`
        )
      }
    }

    return NextResponse.json({
      success: true,
      message: '機種別原価Excel取込が完了しました',
      total_rows: normalizedData.length,
      imported_rows: rows.length,
      parts_created: partsCreated,
      parts_updated: partsUpdated,
      bom_created: bomCreated,
      bom_updated: bomUpdated,
      error_count: rowErrors.length,
      errors: rowErrors.slice(0, 100),
    })
  } catch (err) {
    console.error('import-model-cost error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '取込に失敗しました' },
      { status: 500 }
    )
  }
}
