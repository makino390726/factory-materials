import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  buildCandidatePools,
  defaultMappingFromAuto,
  type LineRow,
  type PartMasterRow,
  type ProductRow,
  type WorkOrderRow,
} from '@/lib/ec30-bom-candidates'
import { drawingToPartKey, mergeEc30RowsByPartKey, parseEc30BomWorkbook } from '@/lib/ec30-bom-parser'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type MappingInput = { kind: string; ref: string }

async function fetchAllProducts(): Promise<ProductRow[]> {
  const PAGE = 1000

  const pageAll = async (select: string): Promise<{ rows: ProductRow[]; error: { message: string } | null }> => {
    let from = 0
    const all: ProductRow[] = []
    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select(select)
        .order('product_code', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) return { rows: [], error }
      const rows = ((data || []) as unknown) as ProductRow[]
      all.push(...rows)
      if (rows.length < PAGE) break
      from += PAGE
    }
    return { rows: all, error: null }
  }

  const withSpec = await pageAll('product_code, name, spec')
  if (!withSpec.error) return withSpec.rows

  const msg = withSpec.error.message || ''
  if (/spec|schema cache|Could not find|column .* does not exist/i.test(msg)) {
    const basic = await pageAll('product_code, name')
    if (basic.error) throw basic.error
    return basic.rows.map((r) => ({ ...r, spec: null as string | null }))
  }

  throw withSpec.error
}

async function fetchAllLines(): Promise<LineRow[]> {
  const PAGE = 1000
  let from = 0
  const all: LineRow[] = []
  while (true) {
    const { data, error } = await supabase
      .from('lines')
      .select('line_code, name')
      .order('line_code', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data || []) as LineRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return all
}

async function fetchAllWorkOrders(): Promise<WorkOrderRow[]> {
  const PAGE = 1000
  let from = 0
  const all: WorkOrderRow[] = []
  while (true) {
    const { data, error } = await supabase
      .from('work_orders')
      .select('order_no, product_name, model')
      .order('order_no', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data || []) as WorkOrderRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return all
}

async function fetchAllPartsMaster(): Promise<PartMasterRow[]> {
  const PAGE = 1000
  let from = 0
  const all: PartMasterRow[] = []
  while (true) {
    const { data, error } = await supabase
      .from('heater_parts_master')
      .select('part_key, part_name, product_code')
      .order('part_key', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data || []) as PartMasterRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return all
}

async function fetchPartCostMap(): Promise<Map<string, number>> {
  const PAGE = 1000
  let from = 0
  const map = new Map<string, number>()
  while (true) {
    const { data, error } = await supabase
      .from('heater_parts_master')
      .select('part_key, cost_price')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    for (const r of rows as { part_key: string; cost_price: number | null }[]) {
      map.set(r.part_key, r.cost_price ?? 0)
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  return map
}

function resolveMappingToDb(
  m: MappingInput,
  pmLookup: Map<string, PartMasterRow>
): { product_code: string | null; spec: string | null } {
  const kind = (m.kind || '').trim()
  const ref = (m.ref || '').trim()
  if (kind === 'skip' || !kind) return { product_code: null, spec: null }
  if (kind === 'product') return { product_code: ref || null, spec: null }
  if (kind === 'line') return { product_code: null, spec: ref ? `照合:L指令 ${ref}` : null }
  if (kind === 'work_order') return { product_code: null, spec: ref ? `照合:D指令 ${ref}` : null }
  if (kind === 'parts_master') {
    const pm = pmLookup.get(ref)
    return {
      product_code: pm?.product_code ?? null,
      spec: ref ? `照合:パーツ ${ref}` : null,
    }
  }
  throw new Error(`不明なマッピング種別: ${kind}`)
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const apply = formData.get('apply') === 'true'
    const mappingsJson = formData.get('mappings_json') as string | null
    const model2 = (formData.get('model_2') as string)?.trim() || 'EC30-2坪'
    const model25 = (formData.get('model_25') as string)?.trim() || 'EC30-2.5坪'
    const model3 = (formData.get('model_3') as string)?.trim() || 'EC30-3坪'

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'Excel ファイル（file）が必要です' }, { status: 400 })
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'ファイルが大きすぎます（25MB 以下）' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const rawRows = parseEc30BomWorkbook(buf)
    const merged = mergeEc30RowsByPartKey(rawRows, (r) => drawingToPartKey(r.drawing_no))

    const [products, lines, workOrders, partsMaster] = await Promise.all([
      fetchAllProducts(),
      fetchAllLines(),
      fetchAllWorkOrders(),
      fetchAllPartsMaster(),
    ])

    const pmLookup = new Map(partsMaster.map((p) => [p.part_key, p]))

    const partKeys = [...merged.keys()].filter(Boolean)

    type RowOut = {
      part_key: string
      part_name: string
      drawing_no: string
      sheets: string
      qty_2tsubo: number
      qty_25tsubo: number
      qty_3tsubo: number
      auto_default: { kind: string; ref: string } | null
      candidate_groups: { exact: unknown[]; partial: unknown[] }
      candidate_options: unknown[]
    }

    const rows: RowOut[] = []
    for (const partKey of partKeys) {
      const v = merged.get(partKey)!
      const pools = buildCandidatePools(v.part_name, products, lines, workOrders, partsMaster, 12)
      const flat = [...pools.exact, ...pools.partial].slice(0, 36)
      const uniq: typeof flat = []
      const seen = new Set<string>()
      for (const o of flat) {
        const k = `${o.kind}:${o.ref}`
        if (seen.has(k)) continue
        seen.add(k)
        uniq.push(o)
      }
      const auto = defaultMappingFromAuto(v.part_name, products, lines, workOrders, partsMaster)
      rows.push({
        part_key: partKey,
        part_name: v.part_name,
        drawing_no: v.drawing_no,
        sheets: v.sheets,
        qty_2tsubo: v.qty_2tsubo,
        qty_25tsubo: v.qty_25tsubo,
        qty_3tsubo: v.qty_3tsubo,
        auto_default: auto ? { kind: auto.kind, ref: auto.ref } : null,
        candidate_groups: { exact: pools.exact, partial: pools.partial },
        candidate_options: uniq,
      })
    }

    if (!apply) {
      const withAuto = rows.filter((r) => r.auto_default).length
      return NextResponse.json({
        dry_run: true,
        summary: {
          raw_rows: rawRows.length,
          merged_parts: rows.length,
          auto_default_count: withAuto,
          needs_review: rows.length - withAuto,
        },
        models: { model_2: model2, model_25: model25, model_3: model3 },
        rows,
      })
    }

    if (!mappingsJson || !mappingsJson.trim()) {
      return NextResponse.json(
        { error: '取り込み実行には mappings_json（全 part_key のマッピング）が必要です。先に解析して画面で確定してください。' },
        { status: 400 }
      )
    }

    let mappings: Record<string, MappingInput>
    try {
      mappings = JSON.parse(mappingsJson) as Record<string, MappingInput>
    } catch {
      return NextResponse.json({ error: 'mappings_json の JSON が不正です' }, { status: 400 })
    }

    const allowed = new Set(['product', 'line', 'work_order', 'parts_master', 'skip'])
    const badKeys: string[] = []
    for (const k of partKeys) {
      const raw = mappings[k]
      const kind = raw && typeof raw.kind === 'string' ? raw.kind.trim() : ''
      if (!raw || !allowed.has(kind)) badKeys.push(k)
    }
    if (badKeys.length > 0) {
      return NextResponse.json(
        {
          error: `マッピングが不正または欠落している part_key が ${badKeys.length} 件あります（先頭: ${badKeys.slice(0, 5).join(', ')}）。各種別は product / line / work_order / parts_master / skip を指定してください。`,
        },
        { status: 400 }
      )
    }

    const costMap = await fetchPartCostMap()

    const partsUpsert: Record<string, unknown>[] = []
    for (const partKey of partKeys) {
      const v = merged.get(partKey)!
      const raw = mappings[partKey]
      const resolved = resolveMappingToDb(raw, pmLookup)
      const row: Record<string, unknown> = {
        part_key: partKey,
        part_name: v.part_name,
        product_code: resolved.product_code,
        cost_price: costMap.get(partKey) ?? 0,
      }
      if (resolved.spec) row.spec = resolved.spec
      partsUpsert.push(row)
    }

    const CHUNK = 200
    for (let i = 0; i < partsUpsert.length; i += CHUNK) {
      const chunk = partsUpsert.slice(i, i + CHUNK)
      const { error } = await supabase.from('heater_parts_master').upsert(chunk, {
        onConflict: 'part_key',
      })
      if (error) {
        return NextResponse.json({ error: `heater_parts_master: ${error.message}` }, { status: 500 })
      }
    }

    const modelsPayload = [
      { model: model2, name: '環境負荷低減型乾燥機（2坪構成）', product_code: null },
      { model: model25, name: '環境負荷低減型乾燥機（2.5坪構成）', product_code: null },
      { model: model3, name: '環境負荷低減型乾燥機（3坪構成）', product_code: null },
    ]
    const { error: modelErr } = await supabase.from('heater_models').upsert(modelsPayload, {
      onConflict: 'model',
    })
    if (modelErr) {
      return NextResponse.json({ error: `heater_models: ${modelErr.message}` }, { status: 500 })
    }

    for (const m of [model2, model25, model3]) {
      const { error: delErr } = await supabase.from('heater_bom').delete().eq('model', m)
      if (delErr) {
        return NextResponse.json({ error: `heater_bom delete: ${delErr.message}` }, { status: 500 })
      }
    }

    const bomRows: { model: string; part_key: string; part_name: string; quantity: number }[] = []
    for (const partKey of partKeys) {
      const v = merged.get(partKey)!
      if (v.qty_2tsubo > 0) {
        bomRows.push({
          model: model2,
          part_key: partKey,
          part_name: v.part_name,
          quantity: v.qty_2tsubo,
        })
      }
      if (v.qty_25tsubo > 0) {
        bomRows.push({
          model: model25,
          part_key: partKey,
          part_name: v.part_name,
          quantity: v.qty_25tsubo,
        })
      }
      if (v.qty_3tsubo > 0) {
        bomRows.push({
          model: model3,
          part_key: partKey,
          part_name: v.part_name,
          quantity: v.qty_3tsubo,
        })
      }
    }

    for (let i = 0; i < bomRows.length; i += CHUNK) {
      const chunk = bomRows.slice(i, i + CHUNK)
      const { error: bomIns } = await supabase.from('heater_bom').insert(chunk)
      if (bomIns) {
        return NextResponse.json({ error: `heater_bom insert: ${bomIns.message}` }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        parts_upserted: partsUpsert.length,
        bom_rows_inserted: bomRows.length,
      },
      models: { model_2: model2, model_25: model25, model_3: model3 },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'インポートに失敗しました'
    console.error('import-ec30', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
