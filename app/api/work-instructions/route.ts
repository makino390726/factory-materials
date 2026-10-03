import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  attachWorkOrderToInstructionProgress,
  isLInstructionOrderNo,
  isMissingInstructionProgressTable,
  normalizeInstructionShops,
  type InstructionDocType,
} from '@/lib/work-instruction-progress'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MISSING_TABLE_MESSAGE =
  '製作指図書のテーブルがありません。Supabase の SQL Editor で migrate-work-instruction-progress.sql を実行してください。'

function missingTableResponse() {
  return NextResponse.json({ error: MISSING_TABLE_MESSAGE, missing_table: true }, { status: 503 })
}

const DOC_TYPES: InstructionDocType[] = ['製作', '切替', '修理']

function lineCodeFromProgressRow(row: Record<string, unknown>) {
  if (row.parent_sort_no != null) return ''
  if (!isLInstructionOrderNo(String(row.series_no || ''))) return ''
  const raw = String(row.item_no || row.branch_no || '')
    .normalize('NFKC')
    .trim()
    .replace(/\.0$/, '')
  if (!raw) return ''
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw
}

/** L指令マスタの構成パーツ。取込の部品行にはパーツコードが無い。 */
async function loadLineMasterParts(rows: Record<string, unknown>[]) {
  const codes = [...new Set(rows.map(lineCodeFromProgressRow).filter(Boolean))]
  const lineParts: Record<
    string,
    Array<{ branch_no: string; part_key: string; part_name: string | null; bom_quantity: number | null }>
  > = {}
  if (!codes.length) return lineParts

  const lines: Array<{ id: string; line_code: string }> = []
  for (let index = 0; index < codes.length; index += 100) {
    const { data, error } = await supabase.from('lines').select('id, line_code').in('line_code', codes.slice(index, index + 100))
    if (error) {
      console.error('L指令マスタの取得エラー:', error)
      return lineParts
    }
    lines.push(...((data || []) as Array<{ id: string; line_code: string }>))
  }

  const assignments: Array<Record<string, unknown>> = []
  const ids = lines.map((line) => line.id)
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase
      .from('line_part_assignments')
      .select('line_id, branch_no, part_key, part_name, bom_quantity')
      .in('line_id', ids.slice(index, index + 100))
    if (error) {
      console.error('L指令パーツの取得エラー:', error)
      return lineParts
    }
    assignments.push(...(data || []))
  }

  const byLine = new Map<string, Array<Record<string, unknown>>>()
  for (const row of assignments) {
    const lineId = String(row.line_id || '')
    const bucket = byLine.get(lineId) || []
    bucket.push(row)
    byLine.set(lineId, bucket)
  }

  for (const line of lines) {
    const key = /^\d+$/.test(String(line.line_code)) ? String(Number(line.line_code)) : String(line.line_code)
    const parts = (byLine.get(line.id) || [])
      .slice()
      .sort((a, b) => String(a.branch_no || '').localeCompare(String(b.branch_no || ''), 'ja'))
      .map((row) => ({
        branch_no: String(row.branch_no || ''),
        part_key: String(row.part_key || ''),
        part_name: row.part_name == null ? null : String(row.part_name),
        bom_quantity: row.bom_quantity == null ? null : Number(row.bom_quantity),
      }))
      .filter((row) => row.part_key)
    if (parts.length) lineParts[key] = parts
  }
  return lineParts
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const workOrderId = String(body?.work_order_id || '').trim()
    const docType = String(body?.doc_type || '').trim() as InstructionDocType
    if (!workOrderId) return NextResponse.json({ error: 'work_order_id が必要です' }, { status: 400 })
    if (!DOC_TYPES.includes(docType)) {
      return NextResponse.json({ error: '反映先は製作、切替、修理から選んでください' }, { status: 400 })
    }

    const { data: order, error } = await supabase
      .from('work_orders')
      .select('id, order_no, product_name, model, qty, fiscal_year')
      .eq('id', workOrderId)
      .single()
    if (error || !order) return NextResponse.json({ error: 'D指令が見つかりません' }, { status: 404 })

    const result = await attachWorkOrderToInstructionProgress(
      supabase,
      {
        id: order.id,
        order_no: order.order_no,
        product_name: order.product_name,
        model: order.model,
        qty: order.qty,
        fiscal_year: order.fiscal_year,
      },
      docType
    )
    return NextResponse.json(result)
  } catch (error) {
    console.error('製作指図書の反映先登録エラー:', error)
    return NextResponse.json({ error: '反映先の登録に失敗しました' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const docType = url.searchParams.get('doc_type') || '製作'
    const fiscalYear = url.searchParams.get('fiscal_year') || 'all'
    const openOnly = url.searchParams.get('open_only') === '1'
    const q = (url.searchParams.get('q') || '').trim()

    const pageSize = 1000
    const rows: Record<string, unknown>[] = []
    for (let from = 0; ; from += pageSize) {
      let query = supabase
        .from('work_instruction_progress')
        .select('*')
        .eq('doc_type', docType)
        .order('sort_no', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
        .range(from, from + pageSize - 1)

      if (fiscalYear !== 'all') {
        const year = Number(fiscalYear)
        if (Number.isFinite(year)) query = query.eq('fiscal_year', year)
      }
      if (openOnly) query = query.is('completed_on', null)

      const { data, error } = await query
      if (error) {
        if (isMissingInstructionProgressTable(error)) return missingTableResponse()
        console.error('製作指図書取得エラー:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      rows.push(...(data || []))
      if (!data || data.length < pageSize) break
    }

    const needle = q.toLowerCase()
    const filtered = needle
      ? rows.filter((row) =>
          [row.series_no, row.item_no, row.product_name, row.model, row.assignee, row.branch_no, row.received_order_no, row.serial_no]
            .some((value) => String(value || '').toLowerCase().includes(needle))
        )
      : rows

    const lineParts = docType === '製作' ? await loadLineMasterParts(rows) : {}
    return NextResponse.json({ rows: filtered, line_parts: lineParts })
  } catch (error) {
    console.error('製作指図書取得エラー:', error)
    return NextResponse.json({ error: '製作指図書の取得に失敗しました' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const id = String(body?.id || '').trim()
    if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 })

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.shops !== undefined) payload.shops = normalizeInstructionShops(body.shops)
    if (body.partial_qty !== undefined) payload.partial_qty = numberOrNull(body.partial_qty)
    if (body.planned_qty !== undefined) payload.planned_qty = numberOrNull(body.planned_qty)
    if (body.completed_on !== undefined) payload.completed_on = dateOrNull(body.completed_on)
    if (body.due_on !== undefined) payload.due_on = dateOrNull(body.due_on)
    if (body.receipt_posted !== undefined) payload.receipt_posted = Boolean(body.receipt_posted)
    if (body.comment !== undefined) payload.comment = textOrNull(body.comment)
    if (body.due_text !== undefined) payload.due_text = textOrNull(body.due_text)
    if (body.series_no !== undefined) payload.series_no = String(body.series_no ?? '').trim()
    if (body.item_no !== undefined) payload.item_no = textOrNull(body.item_no)
    if (body.product_name !== undefined) payload.product_name = textOrNull(body.product_name)
    if (body.assignee !== undefined) payload.assignee = textOrNull(body.assignee)
    if (body.department !== undefined) payload.department = textOrNull(body.department)
    if (body.serial_no !== undefined) payload.serial_no = textOrNull(body.serial_no)

    const { data, error } = await supabase
      .from('work_instruction_progress')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      if (isMissingInstructionProgressTable(error)) return missingTableResponse()
      if (String(error.message || '').includes('item_no')) {
        return NextResponse.json(
          {
            error:
              '№の列がありません。Supabase の SQL Editor で migrate-work-instruction-item-no.sql を実行してください。',
          },
          { status: 503 }
        )
      }
      console.error('製作指図書更新エラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error('製作指図書更新エラー:', error)
    return NextResponse.json({ error: '製作指図書の更新に失敗しました' }, { status: 500 })
  }
}

function numberOrNull(value: unknown) {
  if (value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dateOrNull(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function textOrNull(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}
