import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  attachWorkOrderToInstructionProgress,
  emptyInstructionShops,
  isMissingInstructionProgressTable,
  normalizeInstructionShops,
  parseDrivePdfUrl,
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

/** 28年度（2027/9/1）以降は、進捗が無いので L指令マスタから初期行を作る。 */
const L_MASTER_SEED_FROM_YEAR = 2028

const PROGRESS_COLUMNS =
  'id, doc_type, series_no, fiscal_year, sort_no, parent_sort_no, branch_no, category, product_name, model, assignee, due_on, due_text, wish_text, planned_qty, partial_qty, occurred_on, elapsed_months, completed_on, receipt_posted, comment, received_order_no, pdf_url, shops, source'

async function selectPages<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null }>
) {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1)
    if (error) return { rows, error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return { rows, error: null }
  }
}

/** L指令マスタの構成パーツ。一覧の取得と並行して取る。 */
async function loadAllLineParts() {
  const lineParts: Record<
    string,
    Array<{ branch_no: string; part_key: string; part_name: string | null; bom_quantity: number | null }>
  > = {}
  const [linesResult, assignmentsResult] = await Promise.all([
    selectPages<{ id: string; line_code: string }>((from, to) =>
      supabase.from('lines').select('id, line_code').order('line_code').range(from, to)
    ),
    selectPages<Record<string, unknown>>((from, to) =>
      supabase
        .from('line_part_assignments')
        .select('line_id, branch_no, part_key, part_name, bom_quantity')
        .order('line_id')
        .range(from, to)
    ),
  ])
  if (linesResult.error || assignmentsResult.error) {
    console.error('L指令マスタの取得エラー:', linesResult.error || assignmentsResult.error)
    return lineParts
  }

  const byLine = new Map<string, Array<Record<string, unknown>>>()
  for (const row of assignmentsResult.rows) {
    const lineId = String(row.line_id || '')
    const bucket = byLine.get(lineId) || []
    bucket.push(row)
    byLine.set(lineId, bucket)
  }

  for (const line of linesResult.rows) {
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

function lineCodeKey(value: unknown) {
  const text = String(value || '').normalize('NFKC').trim().replace(/\.0$/, '')
  if (!text) return ''
  return /^\d+$/.test(text) ? String(Number(text)) : text
}

/** 選んだ年度のL指令を、L指令マスタから1回分登録する。同じ指令は足さない。 */
async function registerLMaster(fiscalYear: number) {
  if (!Number.isFinite(fiscalYear) || fiscalYear < L_MASTER_SEED_FROM_YEAR || fiscalYear > 2100) {
    return NextResponse.json({ error: '28年度以降を選んでから、L指令新規登録を実行してください' }, { status: 400 })
  }
  const series = `L令${fiscalYear - 2018}`
  const [linesResult, assignmentsResult, specsResult, existingResult, maxSortResult] = await Promise.all([
    selectPages<{ id: string; line_code: string; name: string | null; sort_order: number | null; is_active: boolean | null }>(
      (from, to) => supabase.from('lines').select('id, line_code, name, sort_order, is_active').order('sort_order').range(from, to)
    ),
    selectPages<{ line_id: string; branch_no: string | null; part_key: string | null; part_name: string | null }>((from, to) =>
      supabase.from('line_part_assignments').select('line_id, branch_no, part_key, part_name').order('line_id').range(from, to)
    ),
    selectPages<{ part_key: string | null; spec: string | null }>((from, to) =>
      supabase.from('heater_parts_master').select('part_key, spec').range(from, to)
    ),
    selectPages<{ branch_no: string | null }>((from, to) =>
      supabase
        .from('work_instruction_progress')
        .select('branch_no')
        .eq('doc_type', '製作')
        .eq('fiscal_year', fiscalYear)
        .eq('series_no', series)
        .is('parent_sort_no', null)
        .range(from, to)
    ),
    supabase.from('work_instruction_progress').select('sort_no').eq('doc_type', '製作').order('sort_no', { ascending: false }).limit(1).maybeSingle(),
  ])
  const failed = linesResult.error || assignmentsResult.error || specsResult.error || existingResult.error || maxSortResult.error
  if (failed) {
    console.error('L指令新規登録の準備エラー:', failed)
    return NextResponse.json({ error: failed.message || 'L指令マスタの取得に失敗しました' }, { status: 500 })
  }

  const existingCodes = new Set(existingResult.rows.map((row) => lineCodeKey(row.branch_no)).filter(Boolean))
  const specByKey = new Map<string, string>()
  for (const part of specsResult.rows) {
    const key = String(part.part_key || '').trim()
    const spec = String(part.spec || '').trim()
    if (key && spec && !specByKey.has(key)) specByKey.set(key, spec)
  }
  const partsByLine = new Map<string, Array<{ branch_no: string | null; part_key: string | null; part_name: string | null }>>()
  for (const part of assignmentsResult.rows) {
    const list = partsByLine.get(part.line_id) || []
    list.push(part)
    partsByLine.set(part.line_id, list)
  }

  const lines = linesResult.rows
    .filter((line) => line.is_active !== false && lineCodeKey(line.line_code))
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || lineCodeKey(a.line_code).localeCompare(lineCodeKey(b.line_code), 'ja'))

  let sortNo = Number(maxSortResult.data?.sort_no || 0)
  const inserts: Array<Record<string, unknown>> = []
  let createdLines = 0
  for (const line of lines) {
    const code = lineCodeKey(line.line_code)
    if (existingCodes.has(code)) continue
    sortNo += 1
    const parentSort = sortNo
    createdLines += 1
    inserts.push({
      doc_type: '製作',
      series_no: series,
      fiscal_year: fiscalYear,
      sort_no: parentSort,
      parent_sort_no: null,
      branch_no: code,
      product_name: String(line.name || '').trim() || null,
      model: null,
      shops: emptyInstructionShops(),
      source: 'l_master',
      receipt_posted: false,
    })
    const parts = (partsByLine.get(line.id) || [])
      .filter((part) => String(part.part_key || '').trim())
      .slice()
      .sort((a, b) => String(a.branch_no || '').localeCompare(String(b.branch_no || ''), 'ja'))
    for (const part of parts) {
      const partKey = String(part.part_key || '').trim()
      sortNo += 1
      inserts.push({
        doc_type: '製作',
        series_no: series,
        fiscal_year: fiscalYear,
        sort_no: sortNo,
        parent_sort_no: parentSort,
        branch_no: partKey,
        product_name: String(part.part_name || '').trim() || null,
        model: specByKey.get(partKey) || null,
        shops: emptyInstructionShops(),
        source: 'l_master',
        receipt_posted: false,
      })
    }
  }

  for (let index = 0; index < inserts.length; index += 200) {
    const { error } = await supabase.from('work_instruction_progress').insert(inserts.slice(index, index + 200))
    if (error) {
      console.error('L指令新規登録エラー:', error)
      return NextResponse.json({ error: error.message || 'L指令の登録に失敗しました' }, { status: 500 })
    }
  }

  return NextResponse.json({ created_lines: createdLines, created_rows: inserts.length, series_no: series })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    if (body?.action === 'register_l_master') {
      return await registerLMaster(Number(body.fiscal_year))
    }
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

    const rowsPromise = (async () => {
      const pageSize = 1000
      const load = async (
        columns: string
      ): Promise<{ rows: Record<string, unknown>[]; error: { message?: string; code?: string } | null }> => {
        const rows: Record<string, unknown>[] = []
        for (let from = 0; ; from += pageSize) {
          let query = supabase
            .from('work_instruction_progress')
            .select(columns)
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
          if (error) return { rows, error }
          const page = (data || []) as unknown as Record<string, unknown>[]
          rows.push(...page)
          if (page.length < pageSize) return { rows, error: null }
        }
      }
      const first = await load(PROGRESS_COLUMNS)
      if (first.error && String(first.error.message || '').includes('pdf_url')) {
        const second = await load(PROGRESS_COLUMNS.replace(', pdf_url', ''))
        return {
          rows: second.rows.map((row) => ({ ...row, pdf_url: null })),
          error: second.error,
        }
      }
      return first
    })()
    const partsPromise = docType === '製作' ? loadAllLineParts() : Promise.resolve({})
    const [loaded, lineParts] = await Promise.all([rowsPromise, partsPromise])
    if (loaded.error) {
      if (isMissingInstructionProgressTable(loaded.error)) return missingTableResponse()
      console.error('製作指図書取得エラー:', loaded.error)
      return NextResponse.json({ error: loaded.error.message }, { status: 500 })
    }
    const rows = loaded.rows

    const needle = q.toLowerCase()
    const filtered = needle
      ? rows.filter((row) =>
          [row.series_no, row.item_no, row.product_name, row.model, row.assignee, row.branch_no, row.received_order_no, row.serial_no]
            .some((value) => String(value || '').toLowerCase().includes(needle))
        )
      : rows

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
    if (body.occurred_on !== undefined) payload.occurred_on = dateOrNull(body.occurred_on)
    if (body.elapsed_months !== undefined) {
      const elapsed = numberOrNull(body.elapsed_months)
      payload.elapsed_months = elapsed == null ? null : Math.round(elapsed)
    }
    if (body.receipt_posted !== undefined) payload.receipt_posted = Boolean(body.receipt_posted)
    if (body.comment !== undefined) payload.comment = textOrNull(body.comment)
    if (body.due_text !== undefined) payload.due_text = textOrNull(body.due_text)
    if (body.series_no !== undefined) payload.series_no = String(body.series_no ?? '').trim()
    if (body.item_no !== undefined) payload.item_no = textOrNull(body.item_no)
    if (body.product_name !== undefined) payload.product_name = textOrNull(body.product_name)
    if (body.model !== undefined) payload.model = textOrNull(body.model)
    if (body.assignee !== undefined) payload.assignee = textOrNull(body.assignee)
    if (body.department !== undefined) payload.department = textOrNull(body.department)
    if (body.category !== undefined) payload.category = textOrNull(body.category)
    if (body.serial_no !== undefined) payload.serial_no = textOrNull(body.serial_no)
    if (body.pdf_url !== undefined) {
      const parsed = parseDrivePdfUrl(body.pdf_url)
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })
      payload.pdf_url = parsed.url
    }

    const { data, error } = await supabase
      .from('work_instruction_progress')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      if (isMissingInstructionProgressTable(error)) return missingTableResponse()
      if (String(error.message || '').includes('pdf_url')) {
        return NextResponse.json(
          {
            error:
              'PDFリンクの列がありません。Supabase の SQL Editor で migrate-work-instruction-pdf-url.sql を実行してください。',
          },
          { status: 503 }
        )
      }
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

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')?.trim() || ''
    if (!id && url.searchParams.get('scope') === 'l_master') {
      const fiscalYear = Number(url.searchParams.get('fiscal_year'))
      if (!Number.isFinite(fiscalYear) || fiscalYear < L_MASTER_SEED_FROM_YEAR) {
        return NextResponse.json({ error: '28年度以降のL指令登録だけ一括削除できます' }, { status: 400 })
      }
      const { error: deleteError, count } = await supabase
        .from('work_instruction_progress')
        .delete({ count: 'exact' })
        .eq('doc_type', '製作')
        .eq('fiscal_year', fiscalYear)
        .eq('source', 'l_master')
      if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })
      return NextResponse.json({ deleted: count ?? 0 })
    }
    if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 })

    const { data: row, error } = await supabase
      .from('work_instruction_progress')
      .select('id, source, sort_no, parent_sort_no, fiscal_year, doc_type, series_no')
      .eq('id', id)
      .maybeSingle()
    if (error) {
      if (isMissingInstructionProgressTable(error)) return missingTableResponse()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!row) return NextResponse.json({ error: '行が見つかりません' }, { status: 404 })
    if (row.source !== 'l_master') {
      return NextResponse.json({ error: 'L指令新規登録で作った行だけ削除できます' }, { status: 400 })
    }

    if (row.parent_sort_no == null && row.sort_no != null) {
      const { error: childError } = await supabase
        .from('work_instruction_progress')
        .delete()
        .eq('doc_type', row.doc_type)
        .eq('fiscal_year', row.fiscal_year)
        .eq('series_no', row.series_no)
        .eq('parent_sort_no', row.sort_no)
        .eq('source', 'l_master')
      if (childError) return NextResponse.json({ error: childError.message }, { status: 500 })
    }

    const { error: deleteError } = await supabase.from('work_instruction_progress').delete().eq('id', id).eq('source', 'l_master')
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error('製作指図書の削除エラー:', error)
    return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 })
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
