import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { spawn } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { parseEc25DrawingWorkbook, type Ec25CoverMeta, type Ec25ParsedPart } from '@/lib/ec25-drawing-bom'
import { mergePurchaseParts, parsePurchaseListExcel } from '@/lib/ec25-purchase-list'
import { asPdfIndex, type Ec25PdfIndex } from '@/lib/ec25-drawing-match'
import { type ProductCostRow } from '@/lib/ec25-material-match'
import {
  buildAnalyzeRows,
  defaultWorkOrder,
  expandWorkOrders,
  type Ec25AnalyzeRow,
  type Ec25WorkOrderDraft,
} from '@/lib/ec25-cost-build'
import { computeCostLineFromMasterUnitPrice } from '@/lib/work-order-cost-from-product-master'
import { type UnfoldResult } from '@/lib/ec25-unfold'

export const runtime = 'nodejs'
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fetchAllProducts(): Promise<ProductCostRow[]> {
  const PAGE = 1000
  const trySelect = async (select: string) => {
    const all: ProductCostRow[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select(select)
        .order('product_code', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) return { rows: [] as ProductCostRow[], error }
      const rows = ((data ?? []) as unknown as ProductCostRow[])
      all.push(...rows)
      if (rows.length < PAGE) break
      from += PAGE
    }
    return { rows: all, error: null as { message: string } | null }
  }

  const full = await trySelect('product_code, name, spec, cost_price')
  if (!full.error) return full.rows
  const msg = full.error.message || ''
  if (/spec/i.test(msg)) {
    const mid = await trySelect('product_code, name, cost_price')
    if (!mid.error) return mid.rows.map((r) => ({ ...r, spec: null }))
  }
  const basic = await trySelect('product_code, name')
  if (basic.error) throw basic.error
  return basic.rows.map((r) => ({ ...r, spec: null, cost_price: 0 }))
}

function runPythonIndex(pdfPath: string, outJson: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'ocr_ec25_drawings.py')
    const child = spawn('python', [script, '--pdf', pdfPath, '--out', outJson, '--dpi', '130', '--workers', '4'], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`図面OCR失敗 (code=${code}): ${stderr.slice(-2000)}`))
    })
  })
}

async function syncWorkOrderBranches(workOrderId: string, bomModel: string) {
  const { data: bomRows, error: bomError } = await supabase
    .from('heater_bom')
    .select('part_key, part_name, quantity')
    .eq('model', bomModel)
    .order('part_key')
  if (bomError) throw new Error(`BOM取得エラー: ${bomError.message}`)
  if (!bomRows || bomRows.length === 0) return { branch_count: 0, total_cost: 0 }

  const partKeys = bomRows.map((b: { part_key: string }) => b.part_key)
  const partsMap: Record<string, { part_name: string | null; product_code: string | null; cost_price: number }> = {}
  if (partKeys.length > 0) {
    const { data: partsData, error: partsError } = await supabase
      .from('heater_parts_master')
      .select('part_key, part_name, product_code, cost_price')
      .in('part_key', partKeys)
    if (partsError) throw new Error(`パーツマスタ取得エラー: ${partsError.message}`)
    for (const p of partsData || []) {
      partsMap[p.part_key] = {
        part_name: p.part_name ?? null,
        product_code: p.product_code ?? null,
        cost_price: Number(p.cost_price || 0),
      }
    }
  }

  await supabase.from('work_order_branches').delete().eq('work_order_id', workOrderId)

  const now = new Date().toISOString()
  const branchRows = bomRows.map((bom: { part_key: string; part_name?: string | null; quantity?: number }, idx: number) => {
    const partInfo = partsMap[bom.part_key] ?? { part_name: null, product_code: null, cost_price: 0 }
    const bomQty = Number(bom.quantity || 1)
    const unitCost = partInfo.cost_price
    return {
      work_order_id: workOrderId,
      branch_no: `B${String(idx + 1).padStart(2, '0')}`,
      part_key: bom.part_key,
      part_name: bom.part_name ?? partInfo.part_name ?? null,
      product_code: partInfo.product_code ?? null,
      bom_quantity: bomQty,
      unit_cost: unitCost,
      subtotal: Math.round(unitCost * bomQty),
      synced_at: now,
      updated_at: now,
    }
  })
  const { error: insertError } = await supabase.from('work_order_branches').insert(branchRows)
  if (insertError) throw new Error(`枝番登録エラー: ${insertError.message}`)
  return {
    branch_count: branchRows.length,
    total_cost: branchRows.reduce((s, r) => s + r.subtotal, 0),
  }
}

type Ec25RegisterTargets = {
  model: boolean
  d_order: boolean
  l_order: boolean
}

function normalizeRegisterTargets(raw: Partial<Ec25RegisterTargets> | null | undefined): Ec25RegisterTargets {
  if (!raw || typeof raw !== 'object') {
    return { model: true, d_order: true, l_order: true }
  }
  return {
    model: !!raw.model,
    d_order: !!raw.d_order,
    l_order: !!raw.l_order,
  }
}

function costLinesForRow(row: Ec25AnalyzeRow) {
  const els = row.elements.length
    ? row.elements
    : [
        {
          role: 'material' as const,
          quantity: null,
          product_code: '',
          product_name: row.part_name,
          spec: row.material_raw,
          unit_price: 0,
          material_raw: row.material_raw,
          family: '',
          candidates: [],
        },
      ]
  return els.map((el, idx) => {
    const elQty =
      el.role === 'fastener'
        ? Number(el.quantity || 0)
        : row.kind === 'assembly'
          ? 0
          : el.quantity != null && el.quantity > 0
            ? Number(el.quantity)
            : row.cost_qty
    const line = computeCostLineFromMasterUnitPrice({
      productCost: el.unit_price,
      quantity: elQty,
      labor_cost: 0,
      cost_type: '加',
    })
    return {
      idx,
      el,
      elQty,
      line,
      component_name: `${el.role === 'fastener' ? '【ビス】' : ''}${el.material_raw || row.material_raw}`,
    }
  })
}

async function ensureWorkOrder(workOrder: Ec25WorkOrderDraft): Promise<string> {
  const { data: existingList, error: findErr } = await supabase
    .from('work_orders')
    .select('id')
    .eq('order_no', workOrder.order_no)
    .limit(1)
  if (findErr) throw new Error(`D指令検索: ${findErr.message}`)

  const payloadWo = {
    order_no: workOrder.order_no,
    product_name: workOrder.product_name,
    model: workOrder.model,
    work_content: '試作（図番管理表＋図面展開原価）',
    qty: workOrder.qty,
    status: '未開始',
    completed: false,
    completed_date: null,
    standard_duration_minutes: 0,
    cost_mode: 'bom',
    bom_model: workOrder.bom_model,
    heater_model: workOrder.bom_model,
  }

  if (existingList && existingList.length > 0) {
    const workOrderId = existingList[0].id
    const { error: updErr } = await supabase.from('work_orders').update(payloadWo).eq('id', workOrderId)
    if (updErr) throw new Error(`D指令更新: ${updErr.message}`)
    return workOrderId
  }
  const { data: created, error: insErr } = await supabase.from('work_orders').insert([payloadWo]).select('id').single()
  if (insErr || !created) throw new Error(`D指令登録: ${insErr?.message || '結果なし'}`)
  return created.id
}

async function upsertPartsMaster(selected: Ec25AnalyzeRow[]) {
  const CHUNK = 200
  const partsUpsert = selected.map((r) => ({
    part_key: r.part_key,
    part_name: r.part_name,
    product_code: r.elements[0]?.product_code || null,
    spec: r.material_raw || r.elements[0]?.spec || null,
    cost_price: r.line_total,
  }))
  for (let i = 0; i < partsUpsert.length; i += CHUNK) {
    const { error } = await supabase.from('heater_parts_master').upsert(partsUpsert.slice(i, i + CHUNK), {
      onConflict: 'part_key',
    })
    if (error) throw new Error(`heater_parts_master: ${error.message}`)
  }
}

async function writeDOrderCostItems(workOrderId: string, workOrder: Ec25WorkOrderDraft, selected: Ec25AnalyzeRow[]) {
  const { data: existingItems } = await supabase
    .from('work_order_cost_items')
    .select('id, work_order_cost_id')
    .eq('master_type', '指令原価')
    .eq('master_id', workOrder.order_no)

  const headerIds = [
    ...new Set((existingItems || []).map((x: { work_order_cost_id?: string }) => x.work_order_cost_id).filter(Boolean)),
  ] as string[]
  if (existingItems && existingItems.length > 0) {
    await supabase.from('work_order_cost_items').delete().eq('master_type', '指令原価').eq('master_id', workOrder.order_no)
  }

  let headerId: string | null = headerIds[0] || null
  if (!headerId) {
    const { data: createdHeader, error: hErr } = await supabase
      .from('work_order_costs')
      .insert([
        {
          work_order_id: workOrderId,
          order_no: workOrder.order_no,
          total_material_cost: 0,
          total_labor_cost: 0,
          total_indirect_cost: 0,
          total_cost: 0,
          notes: `EC25図面原価 D指令 ${workOrder.order_no}`,
        },
      ])
      .select('id')
      .single()
    if (hErr || !createdHeader) throw new Error(`D指令原価ヘッダ: ${hErr?.message || '結果なし'}`)
    headerId = createdHeader.id
  }

  const items: Record<string, unknown>[] = []
  let lineNo = 0
  for (const row of selected) {
    for (const line of costLinesForRow(row)) {
      lineNo += 1
      items.push({
        work_order_cost_id: headerId,
        line_no: lineNo,
        product_code: line.el.product_code || null,
        part_name: line.el.product_name || row.part_name,
        spec: line.el.spec || line.el.material_raw || row.material_raw,
        quantity: line.elQty,
        unit_price: line.line.unit_price,
        material_cost: line.line.material_cost,
        labor_cost: 0,
        indirect_cost: line.line.indirect_cost,
        line_total: line.line.line_total,
        is_manual: true,
        cost_type: '加',
        part_key: row.part_key,
        component_name: line.component_name,
        master_type: '指令原価',
        master_id: workOrder.order_no,
      })
    }
  }

  const CHUNK = 200
  for (let i = 0; i < items.length; i += CHUNK) {
    const { error } = await supabase.from('work_order_cost_items').insert(items.slice(i, i + CHUNK))
    if (error) throw new Error(`D指令原価明細: ${error.message}`)
  }
  return items.length
}

async function writeLOrderCostItems(workOrderId: string, workOrder: Ec25WorkOrderDraft, selected: Ec25AnalyzeRow[]) {
  let costItems = 0
  for (const row of selected) {
    const { data: existingItems } = await supabase
      .from('work_order_cost_items')
      .select('id, work_order_cost_id')
      .eq('master_type', 'ライン原価')
      .eq('master_id', row.part_key)

    const headerIds = [
      ...new Set((existingItems || []).map((x: { work_order_cost_id?: string }) => x.work_order_cost_id).filter(Boolean)),
    ]
    if (existingItems && existingItems.length > 0) {
      await supabase.from('work_order_cost_items').delete().eq('master_type', 'ライン原価').eq('master_id', row.part_key)
    }

    let headerId: string | null = (headerIds[0] as string) || null
    if (!headerId) {
      const { data: createdHeader, error: hErr } = await supabase
        .from('work_order_costs')
        .insert([
          {
            work_order_id: workOrderId,
            order_no: workOrder.order_no,
            total_material_cost: 0,
            total_labor_cost: 0,
            total_indirect_cost: 0,
            total_cost: 0,
            notes: `EC25図面原価 ${row.part_key}`,
          },
        ])
        .select('id')
        .single()
      if (hErr || !createdHeader) throw new Error(`L指令原価ヘッダ: ${hErr?.message || '結果なし'}`)
      headerId = createdHeader.id
    }

    const items = costLinesForRow(row).map((line) => ({
      work_order_cost_id: headerId,
      line_no: line.idx + 1,
      product_code: line.el.product_code || null,
      part_name: line.el.product_name || row.part_name,
      spec: line.el.spec || line.el.material_raw || row.material_raw,
      quantity: line.elQty,
      unit_price: line.line.unit_price,
      material_cost: line.line.material_cost,
      labor_cost: 0,
      indirect_cost: line.line.indirect_cost,
      line_total: line.line.line_total,
      is_manual: true,
      cost_type: '加',
      part_key: row.part_key,
      component_name: line.component_name,
      master_type: 'ライン原価',
      master_id: row.part_key,
    }))
    const { error: itemErr } = await supabase.from('work_order_cost_items').insert(items)
    if (itemErr) throw new Error(`L指令原価明細: ${itemErr.message}`)
    costItems += items.length

    const partTotal = items.reduce((s, it) => s + Number(it.line_total || 0), 0)
    await supabase.from('heater_parts_master').update({ cost_price: partTotal }).eq('part_key', row.part_key)
  }
  return costItems
}

async function applyImport(params: {
  workOrder: Ec25WorkOrderDraft
  rows: Ec25AnalyzeRow[]
  targets: Ec25RegisterTargets
}) {
  const { workOrder, rows, targets } = params
  const selected = rows.filter((r) => r.include)
  const CHUNK = 200

  if (!targets.model && !targets.d_order && !targets.l_order) {
    throw new Error('登録先を1つ以上選んでください（機種 / D指令 / L指令）')
  }
  const drafts = expandWorkOrders(workOrder).filter((d) => String(d.order_no || '').trim())
  if ((targets.d_order || targets.l_order) && drafts.length === 0) {
    throw new Error('D指令・L指令の登録には D指令番号が必要です')
  }

  if (targets.model) {
    const modelPayload = {
      model: workOrder.bom_model,
      name: workOrder.product_name,
      product_code: null as string | null,
      product_category: workOrder.product_category,
    }
    let { error: modelErr } = await supabase.from('heater_models').upsert([modelPayload], { onConflict: 'model' })
    if (modelErr && /product_category/i.test(modelErr.message)) {
      const { product_category: _c, ...legacy } = modelPayload
      const retry = await supabase.from('heater_models').upsert([legacy], { onConflict: 'model' })
      modelErr = retry.error
    }
    if (modelErr) console.warn('heater_models upsert:', modelErr.message)

    await upsertPartsMaster(selected)

    const { error: delErr } = await supabase.from('heater_bom').delete().eq('model', workOrder.bom_model)
    if (delErr) throw new Error(`heater_bom delete: ${delErr.message}`)

    const bomRows = selected.map((r) => ({
      model: workOrder.bom_model,
      part_key: r.part_key,
      part_name: r.part_name,
      quantity: Number(r.qty_pieces) || 1,
    }))
    for (let i = 0; i < bomRows.length; i += CHUNK) {
      const { error } = await supabase.from('heater_bom').insert(bomRows.slice(i, i + CHUNK))
      if (error) throw new Error(`heater_bom insert: ${error.message}`)
    }
  }

  let workOrderId: string | null = null
  let dCostItems = 0
  let lCostItems = 0
  let branchSync: { branch_count: number; total_cost: number } | null = null

  if (targets.d_order || targets.l_order) {
    for (let i = 0; i < drafts.length; i += 1) {
      const draft = drafts[i]
      const id = await ensureWorkOrder(draft)
      if (i === 0) workOrderId = id
      if (targets.d_order) {
        dCostItems += await writeDOrderCostItems(id, draft, selected)
        const sync = await syncWorkOrderBranches(id, draft.bom_model)
        if (i === 0) branchSync = sync
      }
      if (targets.l_order && i === 0) {
        lCostItems = await writeLOrderCostItems(id, draft, selected)
      }
    }
  }

  return {
    work_order_id: workOrderId,
    order_no: drafts[0]?.order_no || workOrder.order_no,
    order_nos: drafts.map((d) => d.order_no),
    bom_model: workOrder.bom_model,
    parts: targets.model ? selected.length : 0,
    d_cost_items: dCostItems,
    l_cost_items: lCostItems,
    cost_items: dCostItems + lCostItems,
    branch_sync: branchSync,
    registered: {
      model: targets.model,
      d_order: targets.d_order,
      l_order: targets.l_order,
    },
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || ''
    let apply = false
    let indexPdf = false
    let excelBuf: Buffer | null = null
    let pdfSaved: string | null = null
    let tmpDir: string | null = null
    let workOrder: Ec25WorkOrderDraft | null = null
    let partsOverride: Ec25ParsedPart[] | null = null
    let coverFromForm: Partial<Ec25CoverMeta> | null = null
    let rowsOverride: Ec25AnalyzeRow[] | null = null
    let unfoldOverrides: Record<string, UnfoldResult> = {}
    let pdfIndex: Ec25PdfIndex = { drawings: {}, pages: [] }
    let registerTargets: Ec25RegisterTargets = { model: true, d_order: true, l_order: true }
    let purchaseParts: Ec25ParsedPart[] = []

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      apply = form.get('apply') === 'true'
      indexPdf = form.get('index_pdf') === 'true'
      const excel = form.get('excel') as File | null
      const pdf = form.get('pdf') as File | null
      const coverJson = form.get('cover_json') as string | null
      const woJson = form.get('work_order') as string | null
      const partsJson = form.get('parts_json') as string | null
      const rowsJson = form.get('rows_json') as string | null
      const unfoldJson = form.get('unfold_json') as string | null
      const indexJson = form.get('index_json') as string | null
      const purchaseJson = form.get('purchase_parts_json') as string | null
      const targetsJson = form.get('register_targets') as string | null
      if (targetsJson) {
        try {
          registerTargets = normalizeRegisterTargets(JSON.parse(targetsJson) as Partial<Ec25RegisterTargets>)
        } catch {
          return NextResponse.json({ error: 'register_targets が不正です' }, { status: 400 })
        }
      }

      if (coverJson) {
        try {
          coverFromForm = JSON.parse(coverJson) as Partial<Ec25CoverMeta>
        } catch {
          return NextResponse.json({ error: 'cover_json が不正です' }, { status: 400 })
        }
      }
      if (woJson) {
        try {
          workOrder = JSON.parse(woJson) as Ec25WorkOrderDraft
        } catch {
          return NextResponse.json({ error: 'work_order が不正です' }, { status: 400 })
        }
      }
      if (partsJson) {
        try {
          partsOverride = JSON.parse(partsJson) as Ec25ParsedPart[]
        } catch {
          return NextResponse.json({ error: 'parts_json が不正です' }, { status: 400 })
        }
      }
      if (rowsJson) {
        try {
          rowsOverride = JSON.parse(rowsJson) as Ec25AnalyzeRow[]
        } catch {
          return NextResponse.json({ error: 'rows_json が不正です' }, { status: 400 })
        }
      }
      if (unfoldJson) {
        try {
          unfoldOverrides = JSON.parse(unfoldJson) as Record<string, UnfoldResult>
        } catch {
          return NextResponse.json({ error: 'unfold_json が不正です' }, { status: 400 })
        }
      }
      if (indexJson) {
        try {
          pdfIndex = asPdfIndex(JSON.parse(indexJson) as Ec25PdfIndex)
        } catch {
          return NextResponse.json({ error: 'index_json が不正です' }, { status: 400 })
        }
      }
      if (purchaseJson) {
        try {
          const parsed = JSON.parse(purchaseJson) as Ec25ParsedPart[]
          if (Array.isArray(parsed)) purchaseParts = parsed
        } catch {
          return NextResponse.json({ error: 'purchase_parts_json が不正です' }, { status: 400 })
        }
      }

      if (excel && excel.size > 0) {
        if (excel.size > 25 * 1024 * 1024) {
          return NextResponse.json({ error: 'Excelが大きすぎます（25MB以下）' }, { status: 400 })
        }
        excelBuf = Buffer.from(await excel.arrayBuffer())
      }
      if (pdf && pdf.size > 0) {
        if (pdf.size > 80 * 1024 * 1024) {
          return NextResponse.json({ error: 'PDFが大きすぎます（80MB以下）' }, { status: 400 })
        }
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ec25-'))
        pdfSaved = path.join(tmpDir, 'drawings.pdf')
        await fs.writeFile(pdfSaved, Buffer.from(await pdf.arrayBuffer()))
      }
    } else {
      const body = await req.json()
      apply = !!body.apply
      if (body.work_order) workOrder = body.work_order as Ec25WorkOrderDraft
      if (body.cover) {
        coverFromForm = body.cover as Partial<Ec25CoverMeta>
      }
      if (Array.isArray(body.rows)) rowsOverride = body.rows as Ec25AnalyzeRow[]
      if (Array.isArray(body.parts)) partsOverride = body.parts as Ec25ParsedPart[]
      if (body.unfold) unfoldOverrides = body.unfold as Record<string, UnfoldResult>
      if (body.drawing_pages || body.pages) {
        pdfIndex = asPdfIndex({
          drawings: body.drawing_pages || {},
          pages: body.pages || [],
          by_name: body.by_name || {},
        })
      }
      if (body.register_targets) {
        registerTargets = normalizeRegisterTargets(body.register_targets as Partial<Ec25RegisterTargets>)
      }
      if (Array.isArray(body.purchase_parts)) {
        purchaseParts = body.purchase_parts as Ec25ParsedPart[]
      }
    }

    let cover: Ec25CoverMeta = { product_name: '', model_type: '', created_on: '', owner: '' }
    let parts: Ec25ParsedPart[] = partsOverride || []

    if (excelBuf) {
      const parsed = parseEc25DrawingWorkbook(excelBuf)
      cover = parsed.cover
      if (!partsOverride) parts = parsed.parts
      const fromSameBook = parsePurchaseListExcel(excelBuf)
      if (fromSameBook.length) purchaseParts = mergePurchaseParts(fromSameBook, purchaseParts)
    }
    if (purchaseParts.length) {
      parts = mergePurchaseParts(parts, purchaseParts)
    }
    if (coverFromForm) {
      cover = {
        ...cover,
        product_name: coverFromForm.product_name || cover.product_name,
        model_type: coverFromForm.model_type || cover.model_type,
        created_on: coverFromForm.created_on || cover.created_on,
        owner: coverFromForm.owner || cover.owner,
        order_no: coverFromForm.order_no || cover.order_no,
        qty: coverFromForm.qty ?? cover.qty,
        orders: coverFromForm.orders?.length ? coverFromForm.orders : cover.orders,
      }
    }
    if (!excelBuf && !partsOverride && !rowsOverride && parts.length === 0) {
      return NextResponse.json(
        { error: '図番管理表の Excel、または購入品一覧が必要です' },
        { status: 400 }
      )
    }

    if (!workOrder) workOrder = defaultWorkOrder(cover)
    else {
      workOrder = {
        ...defaultWorkOrder(cover),
        ...workOrder,
        bom_model: workOrder.bom_model || workOrder.model || cover.model_type,
      }
    }

    if (indexPdf && pdfSaved) {
      const outPath = path.join(tmpDir || os.tmpdir(), 'ec25-index.json')
      await runPythonIndex(pdfSaved, outPath)
      const idx = asPdfIndex(JSON.parse(await fs.readFile(outPath, 'utf-8')) as Ec25PdfIndex)
      pdfIndex = {
        drawings: { ...(pdfIndex.drawings || {}), ...(idx.drawings || {}) },
        by_name: { ...(pdfIndex.by_name || {}), ...(idx.by_name || {}) },
        pages: [...(pdfIndex.pages || []), ...(idx.pages || [])],
      }
    }

    const products = await fetchAllProducts()
    const rows = rowsOverride
      ? rowsOverride.map((r) => {
          const u = unfoldOverrides[r.part_key]
          if (!u) return r
          const rebuilt = buildAnalyzeRows([r.part], products, pdfIndex, unfoldOverrides)[0]
          return rebuilt || r
        })
      : buildAnalyzeRows(parts, products, pdfIndex, unfoldOverrides)

    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }

    const included = rows.filter((r) => r.include)
    const summary = {
      total: rows.length,
      include_count: included.length,
      sheet: rows.filter((r) => r.kind === 'sheet').length,
      profile: rows.filter((r) => r.kind === 'profile').length,
      purchased: rows.filter((r) => r.kind === 'purchased').length,
      fastener_lines: rows.reduce((s, r) => s + (r.part.fasteners?.length || 0), 0),
      assembly: rows.filter((r) => r.kind === 'assembly').length,
      matched: included.filter((r) => r.elements.some((e) => e.product_code)).length,
      unfoldable: rows.filter((r) => r.unfoldable).length,
      material_cost: included.reduce((s, r) => s + r.material_cost, 0),
      line_total: included.reduce((s, r) => s + r.line_total, 0),
      pdf_linked: rows.filter((r) => r.pdf_pages.length > 0).length,
    }

    if (!apply) {
      return NextResponse.json({
        dry_run: true,
        cover,
        work_order: workOrder,
        summary,
        rows,
        drawing_pages: pdfIndex.drawings || {},
        pages: pdfIndex.pages || [],
        by_name: pdfIndex.by_name || {},
        ai: {
          hint: 'AI展開は /api/heater/bom/ec25-unfold で実行。ANTHROPIC_API_KEY または OPENAI_API_KEY を設定すると高スペック Vision で図面から展開数量を算出します。',
        },
      })
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: '取込対象がありません。先にExcelを解析してください' }, { status: 400 })
    }

    if (!registerTargets.model && !registerTargets.d_order && !registerTargets.l_order) {
      return NextResponse.json(
        { error: '登録先を1つ以上選んでください（機種登録 / D指令登録 / L指令登録）' },
        { status: 400 }
      )
    }

    const result = await applyImport({ workOrder, rows, targets: registerTargets })
    return NextResponse.json({ success: true, cover, work_order: workOrder, summary, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'EC25図面原価取込に失敗しました'
    console.error('import-ec25', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
