import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/work-orders/bom-cost?work_order_id=xxx
 *
 * BOM集計モードの指令について、枝番ごとの原価と原価明細を返す。
 *
 * レスポンス:
 * {
 *   work_order: { id, order_no, product_name, model, bom_model, cost_mode, qty },
 *   grand_total: number,          // 全枝番の subtotal 合計
 *   branches: [
 *     {
 *       branch_no, part_key, part_name, product_code,
 *       bom_quantity, unit_cost, subtotal, synced_at,
 *       cost_items: [             // 指令原価明細（無ければライン原価明細）
 *         { product_code, part_name, spec, quantity, unit_price,
 *           material_cost, labor_cost, indirect_cost, line_total, cost_type }
 *       ]
 *     }
 *   ]
 * }
 *
 * POST /api/work-orders/bom-cost
 * body: { work_order_id: string }
 * 現在の枝番合計を work_order_costs に保存（スナップショット）
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const work_order_id = searchParams.get('work_order_id')

    if (!work_order_id) {
      return NextResponse.json({ error: 'work_order_id は必須です' }, { status: 400 })
    }

    // 1) 指令基本情報（standard_duration_minutes を含める）
    const { data: wo, error: woErr } = await supabase
      .from('work_orders')
      .select('id, order_no, product_name, model, bom_model, cost_mode, qty, standard_duration_minutes')
      .eq('id', work_order_id)
      .maybeSingle()

    if (woErr || !wo) {
      return NextResponse.json({ error: '指令が見つかりません' }, { status: 404 })
    }

    // 2) 枝番一覧
    const { data: branches, error: brErr } = await supabase
      .from('work_order_branches')
      .select('*')
      .eq('work_order_id', work_order_id)
      .order('branch_no', { ascending: true })

    if (brErr) {
      return NextResponse.json({ error: brErr.message }, { status: 500 })
    }

    // 枝番を 2 桁ゼロパディング化（1 → 01, B01 → 01）
    const formatBranchNo = (branchNo: string): string => {
      const stripped = branchNo.replace(/^[A-Za-z]+/, '').replace(/^0+/, '')
      if (!stripped) return branchNo
      return String(parseInt(stripped)).padStart(2, '0')
    }

    // 全ブランチで複数の候補キーを生成して一致を探す
    // 候補1: order_no-{2桁枝番} (e.g. DR8-0004-01)
    // 候補2: part_key（BOM同期由来のキー互換）
    // ※ order_no 単体フォールバックは、DR8-0004 と DR8-0004-1 の衝突を招くため使用しない
    const branchCandidateKeys: string[][] = (branches || []).map((b: any) => {
      const partKey = String(b.part_key || '')
      const branchNo = String(b.branch_no || '')
      const formattedNo = formatBranchNo(branchNo)
      const keys = [`${wo.order_no}-${formattedNo}`]
      if (partKey) keys.push(partKey)
      return keys
    })

    // 全候補キーを重複排除して一括取得
    const allCandidateKeys = [...new Set(branchCandidateKeys.flat())]

    // 3) 各枝番キーに紐づく原価明細を取得
    //    - まず 指令原価 を優先
    //    - 指令原価が無い枝番は ライン原価 を使用
    let orderCostItemsMap: Record<string, any[]> = {}
    let lineCostItemsMap: Record<string, any[]> = {}
    if (allCandidateKeys.length > 0) {
      const { data: costItems, error: ciErr } = await supabase
        .from('work_order_cost_items')
        .select('id, master_id, master_type, product_code, part_name, spec, quantity, unit_price, material_cost, labor_cost, indirect_cost, line_total, cost_type')
        .in('master_type', ['指令原価', 'ライン原価'])
        .in('master_id', allCandidateKeys)
        .order('line_no', { ascending: true })

      if (ciErr) {
        console.error('cost_items fetch error:', ciErr)
      }

      for (const item of costItems || []) {
        const key = item.master_id as string
        const mappedItem = {
          id: item.id,
          product_code: item.product_code ?? '',
          part_name: item.part_name ?? '',
          spec: item.spec ?? '',
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
          material_cost: Number(item.material_cost || 0),
          labor_cost: Number(item.labor_cost || 0),
          indirect_cost: Number(item.indirect_cost || 0),
          line_total: Number(item.line_total || 0),
          cost_type: item.cost_type || '加',
        }

        if (item.master_type === '指令原価') {
          if (!orderCostItemsMap[key]) orderCostItemsMap[key] = []
          orderCostItemsMap[key].push(mappedItem)
        } else {
          if (!lineCostItemsMap[key]) lineCostItemsMap[key] = []
          lineCostItemsMap[key].push(mappedItem)
        }
      }
    }

    // 4) 集計
    // cost_items がある場合はその合計を使い、なければ work_order_branches.subtotal を使う
    const LABOR_UNIT_PRICE = 17810
    const INDIRECT_RATE = 0.3
    const branchesWithItems = (branches || []).map((b: any, i: number) => {
      // 枝番 "00" は全体工賃の合成アイテムを生成
      if (b.branch_no === '00') {
        const qty = Number(b.bom_quantity || 0)
        const unitPrice = Number(b.unit_cost || LABOR_UNIT_PRICE)
        const laborAmt = Math.round(qty * unitPrice)
        const indirectAmt = Math.round(laborAmt * INDIRECT_RATE)
        const lineTotal = laborAmt + indirectAmt
        const syntheticItem = {
          id: `${b.id}-labor`,
          product_code: '',
          part_name: '工賃',
          spec: '',
          quantity: qty,
          unit_price: unitPrice,
          material_cost: 0,
          labor_cost: laborAmt,
          indirect_cost: indirectAmt,
          line_total: lineTotal,
          cost_type: '加',
        }
        return {
          id: b.id,
          branch_no: b.branch_no,
          part_key: b.part_key,
          part_name: b.part_name ?? '工賃',
          product_code: null,
          bom_quantity: qty,
          unit_cost: unitPrice,
          subtotal: lineTotal,
          notes: b.notes ?? null,
          synced_at: b.synced_at ?? null,
          cost_items: [syntheticItem],
        }
      }

      // 通常枝番：候補キーを順番に試して最初にヒットした items を使う
      let items: any[] = []
      for (const candidateKey of branchCandidateKeys[i]) {
        const found = orderCostItemsMap[candidateKey] ?? lineCostItemsMap[candidateKey]
        if (found && found.length > 0) {
          items = found
          break
        }
      }
      const computedSubtotal = items.length > 0
        ? Math.round(items.reduce((s: number, item: any) => s + item.line_total, 0) * Number(b.bom_quantity || 1))
        : Number(b.subtotal || 0)
      return {
        id: b.id,
        branch_no: b.branch_no,
        part_key: b.part_key,
        part_name: b.part_name ?? null,
        product_code: b.product_code ?? null,
        bom_quantity: Number(b.bom_quantity || 1),
        unit_cost: items.length > 0
          ? Math.round(items.reduce((s: number, item: any) => s + item.line_total, 0))
          : Number(b.unit_cost || 0),
        subtotal: computedSubtotal,
        notes: b.notes ?? null,
        synced_at: b.synced_at ?? null,
        cost_items: items,
      }
    })

    // 枝番 "00"（全体工賃）が DB に存在しない場合は合成で先頭に注入する
    const hasBranch00 = branchesWithItems.some((b: any) => b.branch_no === '00')
    let finalBranches = branchesWithItems

    if (!hasBranch00) {
      const stdMinutes = Number(wo.standard_duration_minutes || 0)
      const laborQty = stdMinutes > 0 ? Math.round((stdMinutes / 480) * 1000) / 1000 : 0
      const laborAmt = Math.round(laborQty * LABOR_UNIT_PRICE)
      const indirectAmt = Math.round(laborAmt * INDIRECT_RATE)
      const lineTotal = laborAmt + indirectAmt
      const syntheticBranch00 = {
        id: `${wo.id}-labor-synthetic`,
        branch_no: '00',
        part_key: `${wo.order_no}-00`,
        part_name: '工賃',
        product_code: null,
        bom_quantity: laborQty,
        unit_cost: LABOR_UNIT_PRICE,
        subtotal: lineTotal,
        notes: null,
        synced_at: null,
        cost_items: [{
          id: `${wo.id}-labor-item`,
          product_code: '',
          part_name: '工賃',
          spec: `所要時間 ${stdMinutes}分`,
          quantity: laborQty,
          unit_price: LABOR_UNIT_PRICE,
          material_cost: 0,
          labor_cost: laborAmt,
          indirect_cost: indirectAmt,
          line_total: lineTotal,
          cost_type: '加',
        }],
      }
      finalBranches = [syntheticBranch00, ...branchesWithItems]
    }

    const grandTotal = finalBranches.reduce((sum: number, b: any) => sum + b.subtotal, 0)

    return NextResponse.json({
      work_order: wo,
      grand_total: grandTotal,
      branches: finalBranches,
      order_labor_cost: 0,
    })
  } catch (err) {
    console.error('bom-cost GET error:', err)
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

/**
 * POST /api/work-orders/bom-cost
 * 現在の枝番合計を work_order_costs に保存（スナップショット）
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { work_order_id } = body

    if (!work_order_id) {
      return NextResponse.json({ error: 'work_order_id は必須です' }, { status: 400 })
    }

    // 指令情報取得（standard_duration_minutes を含める）
    const { data: wo } = await supabase
      .from('work_orders')
      .select('id, order_no, cost_mode, standard_duration_minutes')
      .eq('id', work_order_id)
      .maybeSingle()

    if (!wo) {
      return NextResponse.json({ error: '指令が見つかりません' }, { status: 404 })
    }

    // 枝番一覧取得
    const { data: branches } = await supabase
      .from('work_order_branches')
      .select('*')
      .eq('work_order_id', work_order_id)
      .order('branch_no', { ascending: true })

    const branchesTotalCost = (branches || []).reduce(
      (sum: number, b: any) => sum + (Number(b.subtotal) || 0),
      0
    )

    // 指令全体の工賃を加算
    const LABOR_RATE_PER_MINUTE = 100
    const orderLaborCost = Math.round((wo.standard_duration_minutes || 0) * LABOR_RATE_PER_MINUTE)
    const totalCost = branchesTotalCost + orderLaborCost

    const now = new Date().toISOString()

    // work_order_costs に upsert（work_order_id 単位で1件）
    const { data: existing } = await supabase
      .from('work_order_costs')
      .select('id')
      .eq('work_order_id', work_order_id)
      .maybeSingle()

    let costHeader: any
    if (existing) {
      const { data: updated } = await supabase
        .from('work_order_costs')
        .update({
          total_cost: totalCost,
          total_material_cost: totalCost, // BOM集計は material_cost として扱う
          total_labor_cost: 0,
          total_indirect_cost: 0,
          cost_mode: 'bom',
          branch_count: (branches || []).length,
          last_bom_sync: now,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select()
        .maybeSingle()
      costHeader = updated
    } else {
      const { data: inserted } = await supabase
        .from('work_order_costs')
        .insert({
          work_order_id,
          order_no: wo.order_no,
          total_cost: totalCost,
          total_material_cost: totalCost,
          total_labor_cost: 0,
          total_indirect_cost: 0,
          cost_mode: 'bom',
          branch_count: (branches || []).length,
          last_bom_sync: now,
          created_at: now,
          updated_at: now,
        })
        .select()
        .maybeSingle()
      costHeader = inserted
    }

    return NextResponse.json({
      success: true,
      total_cost: totalCost,
      branch_count: (branches || []).length,
      cost_header: costHeader,
    })
  } catch (err) {
    console.error('bom-cost POST error:', err)
    return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
  }
}
