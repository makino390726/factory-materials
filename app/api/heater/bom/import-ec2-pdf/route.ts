import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { spawn } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  normalizePayload,
  type Ec2BomPayload,
  type Ec2ParsedPart,
} from '@/lib/ec2-pdf-bom'

export const runtime = 'nodejs'
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function syncWorkOrderBranchesFromBom(workOrderId: string, bomModel: string) {
  const { data: bomRows, error: bomError } = await supabase
    .from('heater_bom')
    .select('part_key, part_name, quantity')
    .eq('model', bomModel)
    .order('part_key')

  if (bomError) throw new Error(`BOM取得エラー: ${bomError.message}`)

  const partKeys = (bomRows || []).map((b: { part_key: string }) => b.part_key)
  const partsMap: Record<
    string,
    { part_name: string | null; product_code: string | null; cost_price: number }
  > = {}

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

  if (!bomRows || bomRows.length === 0) {
    return { branch_count: 0, total_cost: 0 }
  }

  const now = new Date().toISOString()
  const branchRows = bomRows.map((bom: any, idx: number) => {
    const partKey = bom.part_key as string
    const partInfo = partsMap[partKey] ?? {
      part_name: null,
      product_code: null,
      cost_price: 0,
    }
    const bomQty = Number(bom.quantity || 1)
    const unitCost = partInfo.cost_price
    const subtotal = Math.round(unitCost * bomQty)
    return {
      work_order_id: workOrderId,
      branch_no: `B${String(idx + 1).padStart(2, '0')}`,
      part_key: partKey,
      part_name: bom.part_name ?? partInfo.part_name ?? null,
      product_code: partInfo.product_code ?? null,
      bom_quantity: bomQty,
      unit_cost: unitCost,
      subtotal,
      synced_at: now,
      updated_at: now,
    }
  })

  const { error: insertError } = await supabase.from('work_order_branches').insert(branchRows)
  if (insertError) throw new Error(`枝番登録エラー: ${insertError.message}`)
  const totalCost = branchRows.reduce((sum, row) => sum + row.subtotal, 0)
  return { branch_count: branchRows.length, total_cost: totalCost }
}

function runPythonOcr(partsPdfPath: string, outJsonPath: string, rawJsonPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'ocr_ec2_parts_pdf.py')
    const child = spawn(
      'python',
      [script, '--parts-pdf', partsPdfPath, '--out', outJsonPath, '--save-raw', rawJsonPath],
      { cwd: process.cwd(), env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
    )
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`OCRスクリプト失敗 (code=${code}): ${stderr.slice(-2000)}`))
    })
  })
}

async function applyImport(payload: Ec2BomPayload, selected: Ec2ParsedPart[]) {
  const wo = payload.work_order
  const drawingParts = selected.filter((p) => p.include && p.kind === 'drawing_part' && p.part_key)
  const purchased = selected.filter((p) => p.include && p.kind === 'purchased')

  // heater_models
  const { error: modelErr } = await supabase.from('heater_models').upsert(
    [{ model: wo.bom_model, name: wo.product_name, product_code: null }],
    { onConflict: 'model' }
  )
  if (modelErr) {
    // テーブルが無い環境もあるため警告のみ
    console.warn('heater_models upsert:', modelErr.message)
  }

  // parts master
  const CHUNK = 200
  if (drawingParts.length > 0) {
    const partsUpsert = drawingParts.map((p) => ({
      part_key: p.part_key!,
      part_name: p.part_name,
      product_code: null as string | null,
      cost_price: 0,
      spec: p.spec || p.material || null,
    }))
    for (let i = 0; i < partsUpsert.length; i += CHUNK) {
      const chunk = partsUpsert.slice(i, i + CHUNK)
      const { error } = await supabase.from('heater_parts_master').upsert(chunk, {
        onConflict: 'part_key',
      })
      if (error) throw new Error(`heater_parts_master: ${error.message}`)
    }
  }

  // replace BOM for this model
  const { error: delErr } = await supabase.from('heater_bom').delete().eq('model', wo.bom_model)
  if (delErr) throw new Error(`heater_bom delete: ${delErr.message}`)

  if (drawingParts.length > 0) {
    const bomRows = drawingParts.map((p) => ({
      model: wo.bom_model,
      part_key: p.part_key!,
      part_name: p.part_name,
      quantity: Number(p.qty) || 1,
    }))
    for (let i = 0; i < bomRows.length; i += CHUNK) {
      const chunk = bomRows.slice(i, i + CHUNK)
      const { error } = await supabase.from('heater_bom').insert(chunk)
      if (error) throw new Error(`heater_bom insert: ${error.message}`)
    }
  }

  // D指令: 既存があれば更新、なければ作成
  const { data: existingList, error: findErr } = await supabase
    .from('work_orders')
    .select('id, order_no, product_name, model')
    .eq('order_no', wo.order_no)
    .limit(5)
  if (findErr) throw new Error(`D指令検索: ${findErr.message}`)

  let workOrderId: string
  const payloadWo = {
    order_no: wo.order_no,
    product_name: wo.product_name,
    model: wo.product_name,
    work_content: '試作（PDF部品表取込）',
    qty: wo.qty,
    status: '未開始',
    completed: false,
    completed_date: null,
    standard_duration_minutes: 0,
    cost_mode: 'bom',
    bom_model: wo.bom_model,
  }

  if (existingList && existingList.length > 0) {
    workOrderId = existingList[0].id
    const { error: updErr } = await supabase.from('work_orders').update(payloadWo).eq('id', workOrderId)
    if (updErr) throw new Error(`D指令更新: ${updErr.message}`)
  } else {
    const { data: created, error: insErr } = await supabase
      .from('work_orders')
      .insert([payloadWo])
      .select('id')
      .single()
    if (insErr || !created) throw new Error(`D指令登録: ${insErr?.message || '結果なし'}`)
    workOrderId = created.id
  }

  const branchSync = await syncWorkOrderBranchesFromBom(workOrderId, wo.bom_model)

  // 購入品 → D指令原価明細（単価0で登録、後から原価入力）
  let purchasedCount = 0
  if (purchased.length > 0) {
    let headerId: string | null = null
    const { data: headers } = await supabase
      .from('work_order_costs')
      .select('id')
      .eq('work_order_id', workOrderId)
      .order('updated_at', { ascending: false })
      .limit(1)

    if (headers && headers.length > 0) {
      headerId = headers[0].id
    } else {
      const { data: createdHeader, error: hErr } = await supabase
        .from('work_order_costs')
        .insert([
          {
            work_order_id: workOrderId,
            order_no: wo.order_no,
            total_material_cost: 0,
            total_labor_cost: 0,
            total_indirect_cost: 0,
            total_cost: 0,
            notes: 'EC2 PDF取込: 購入品（単価未設定）',
          },
        ])
        .select('id')
        .single()
      if (hErr || !createdHeader) throw new Error(`原価ヘッダ: ${hErr?.message || '結果なし'}`)
      headerId = createdHeader.id
    }

    // EC2取込の購入品行のみ差し替え（仕様欄プレフィックスで識別）
    const { data: existingItems } = await supabase
      .from('work_order_cost_items')
      .select('id, spec, line_no')
      .eq('work_order_cost_id', headerId)
    const purchasedIds = (existingItems || [])
      .filter((it: { spec?: string | null }) => String(it.spec || '').startsWith('【購入品】'))
      .map((it: { id: string }) => it.id)
    if (purchasedIds.length > 0) {
      await supabase.from('work_order_cost_items').delete().in('id', purchasedIds)
    }
    const maxLine = (existingItems || []).reduce(
      (m: number, it: { line_no?: number }) => Math.max(m, Number(it.line_no || 0)),
      0
    )

    const items = purchased.map((p, idx) => ({
      work_order_cost_id: headerId,
      line_no: maxLine + idx + 1,
      product_code: null,
      part_name: p.part_name,
      spec: `【購入品】${p.spec || p.material || p.note || ''}`.trim(),
      quantity: Number(p.qty) || 1,
      unit_price: 0,
      material_cost: 0,
      labor_cost: 0,
      indirect_cost: 0,
      line_total: 0,
      is_manual: true,
      cost_type: '加',
      part_key: null,
      master_type: '指令原価',
      master_id: wo.order_no,
    }))

    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK)
      const { error } = await supabase.from('work_order_cost_items').insert(chunk)
      if (error) throw new Error(`購入品明細: ${error.message}`)
    }
    purchasedCount = items.length
  }

  return {
    work_order_id: workOrderId,
    order_no: wo.order_no,
    bom_model: wo.bom_model,
    drawing_parts: drawingParts.length,
    purchased_items: purchasedCount,
    branch_sync: branchSync,
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || ''
    let apply = false
    let payload: Ec2BomPayload | null = null
    let partsOverride: Ec2ParsedPart[] | null = null

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      apply = form.get('apply') === 'true'
      const jsonFile = form.get('json') as File | null
      const partsPdf = form.get('parts_pdf') as File | null
      const partsJson = form.get('parts_json') as string | null

      if (partsJson) {
        try {
          partsOverride = JSON.parse(partsJson) as Ec2ParsedPart[]
        } catch {
          return NextResponse.json({ error: 'parts_json が不正です' }, { status: 400 })
        }
      }

      if (jsonFile && jsonFile.size > 0) {
        const text = Buffer.from(await jsonFile.arrayBuffer()).toString('utf-8')
        payload = normalizePayload(JSON.parse(text) as Ec2BomPayload)
      } else if (partsPdf && partsPdf.size > 0) {
        if (partsPdf.size > 40 * 1024 * 1024) {
          return NextResponse.json({ error: 'PDFが大きすぎます（40MB以下）' }, { status: 400 })
        }
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ec2-pdf-'))
        const pdfPath = path.join(tmp, 'parts.pdf')
        const outPath = path.join(tmp, 'parsed.json')
        const rawPath = path.join(tmp, 'raw.json')
        await fs.writeFile(pdfPath, Buffer.from(await partsPdf.arrayBuffer()))
        await runPythonOcr(pdfPath, outPath, rawPath)
        const text = await fs.readFile(outPath, 'utf-8')
        payload = normalizePayload(JSON.parse(text) as Ec2BomPayload)
        // cleanup best-effort
        try {
          await fs.rm(tmp, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      } else {
        return NextResponse.json(
          { error: 'parts_pdf（部品表PDF）または json（解析済みJSON）が必要です' },
          { status: 400 }
        )
      }
    } else {
      const body = await req.json()
      apply = !!body.apply
      if (body.payload) {
        payload = normalizePayload(body.payload as Ec2BomPayload)
      } else {
        payload = normalizePayload(body as Ec2BomPayload)
      }
      if (Array.isArray(body.parts)) {
        partsOverride = body.parts as Ec2ParsedPart[]
      }
    }

    if (!payload) {
      return NextResponse.json({ error: '解析データがありません' }, { status: 400 })
    }

    // 画面側で編集した work_order / parts を反映
    if (partsOverride) {
      payload = normalizePayload({ ...payload, parts: partsOverride })
    }

    if (!apply) {
      return NextResponse.json({
        dry_run: true,
        work_order: payload.work_order,
        summary: payload.summary,
        parts: payload.parts,
        source: payload.source || null,
      })
    }

    const selected = payload.parts.filter((p) => p.include)
    if (selected.length === 0) {
      return NextResponse.json({ error: '取込対象部品がありません（include を確認）' }, { status: 400 })
    }

    const result = await applyImport(payload, selected)
    return NextResponse.json({ success: true, ...result, work_order: payload.work_order })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'EC2 PDF取込に失敗しました'
    console.error('import-ec2-pdf', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
