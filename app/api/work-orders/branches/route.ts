import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function hasMissingColumnError(error: any, columnName: string) {
  const msg = String(error?.message || '')
  return msg.includes(`Could not find the '${columnName}' column`)
}

function toPartKeyBranchNo(branchNo: string): string {
  const raw = String(branchNo || '').trim()
  const stripped = raw.replace(/^[A-Za-z]+/, '').replace(/^0+/, '')
  if (!stripped) return raw
  const parsed = Number.parseInt(stripped, 10)
  return Number.isFinite(parsed) ? String(parsed).padStart(2, '0') : stripped
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/work-orders/branches?work_order_id=xxx
 * 指定のD指令に紐づく枝番一覧を取得する
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const work_order_id = searchParams.get('work_order_id')

    if (!work_order_id) {
      return NextResponse.json({ error: 'work_order_id は必須です' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('work_order_branches')
      .select('*')
      .eq('work_order_id', work_order_id)
      .order('branch_no', { ascending: true })

    if (error) {
      console.error('branches GET error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const total_cost = (data || []).reduce((sum, b) => sum + (b.subtotal ?? 0), 0)

    return NextResponse.json({ branches: data || [], total_cost })
  } catch (err) {
    console.error('branches GET error:', err)
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

/**
 * POST /api/work-orders/branches/sync  ← /sync サブルートに分けても良いが、
 * action='sync' で一本化する。
 *
 * body: { work_order_id: string, action: 'sync' | 'upsert' | 'delete_branch', ... }
 *
 * action='sync':
 *   work_orders.bom_model を参照して heater_bom × heater_parts_master から
 *   枝番を自動生成・更新する。既存枝番は unit_cost を再計算して上書き。
 *   BOMに存在しなくなった枝番は削除する。
 *
 * action='upsert':
 *   body.branches (配列) を一括 upsert する。手動調整用。
 *
 * action='delete_branch':
 *   body.branch_id を指定して1件削除する。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { work_order_id, action } = body

    if (!work_order_id) {
      return NextResponse.json({ error: 'work_order_id は必須です' }, { status: 400 })
    }

    // ---- action: sync (BOM同期) ----
    if (action === 'sync') {
      const bom_model: string | undefined = body.bom_model

      // work_orders から bom_model・order_no・所要時間を取得
      const { data: woInfo } = await supabase
        .from('work_orders')
        .select('bom_model, order_no, standard_duration_minutes')
        .eq('id', work_order_id)
        .maybeSingle()

      let model = bom_model ?? woInfo?.bom_model ?? undefined
      const orderNo = woInfo?.order_no ?? ''
      const stdMinutes = Number(woInfo?.standard_duration_minutes || 0)

      if (!model) {
        return NextResponse.json(
          { error: 'BOMモデルが指定されていません。D指令の bom_model を設定してください。' },
          { status: 400 }
        )
      }

      // heater_bom からパーツ一覧を取得
      const { data: bomRows, error: bomErr } = await supabase
        .from('heater_bom')
        .select('part_key, part_name, quantity')
        .eq('model', model)
        .order('part_key')

      if (bomErr) {
        return NextResponse.json({ error: bomErr.message }, { status: 500 })
      }

      if (!bomRows || bomRows.length === 0) {
        return NextResponse.json(
          { error: `モデル '${model}' のBOMが見つかりません` },
          { status: 404 }
        )
      }

      const partKeys = bomRows.map((b: any) => b.part_key as string)

      // heater_parts_master から原価を取得
      const { data: partsData, error: partsErr } = await supabase
        .from('heater_parts_master')
        .select('part_key, part_name, product_code, cost_price')
        .in('part_key', partKeys)

      if (partsErr) {
        return NextResponse.json({ error: partsErr.message }, { status: 500 })
      }

      const partsMap: Record<
        string,
        { part_name: string | null; product_code: string | null; cost_price: number }
      > = {}
      for (const p of partsData || []) {
        partsMap[p.part_key] = {
          part_name: p.part_name ?? null,
          product_code: p.product_code ?? null,
          cost_price: Number(p.cost_price || 0),
        }
      }

      // 枝番を生成（B01, B02 ... B99）
      const now = new Date().toISOString()
      const bomBranches = bomRows.map((bom: any, idx: number) => {
        const partKey = bom.part_key as string
        const partInfo = partsMap[partKey] ?? {
          part_name: null,
          product_code: null,
          cost_price: 0,
        }
        const bomQty = Number(bom.quantity || 1)
        const unitCost = partInfo.cost_price
        const subtotal = Math.round(unitCost * bomQty)
        const branchNo = `B${String(idx + 1).padStart(2, '0')}`

        return {
          work_order_id,
          branch_no: branchNo,
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

      // 枝番 "00"（全体工賃）を先頭に自動生成
      // 数量 = standard_duration_minutes / 480（1日=480分）、単価 = ¥17,810
      // 工賃 = 数量 × 単価、間接費 = 工賃 × 30%、小計 = 工賃 + 間接費
      const LABOR_UNIT_PRICE = 17810
      const INDIRECT_RATE = 0.3
      const laborQty = stdMinutes > 0 ? Math.round((stdMinutes / 480) * 1000) / 1000 : 0
      const laborCostAmt = Math.round(laborQty * LABOR_UNIT_PRICE)
      const indirectCostAmt = Math.round(laborCostAmt * INDIRECT_RATE)
      const laborBranch = {
        work_order_id,
        branch_no: '00',
        part_key: `${orderNo}-00`,
        part_name: '工賃',
        product_code: null as string | null,
        bom_quantity: laborQty,
        unit_cost: LABOR_UNIT_PRICE,
        subtotal: laborCostAmt + indirectCostAmt,
        synced_at: now,
        updated_at: now,
      }

      // 枝番 "00" は standard_duration_minutes が 0 でも常に先頭に生成する
      const upsertRows = [laborBranch, ...bomBranches]

      // 既存の枝番を全削除して再生成（BOM変更に追従するため）
      const { error: delErr } = await supabase
        .from('work_order_branches')
        .delete()
        .eq('work_order_id', work_order_id)

      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 })
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('work_order_branches')
        .insert(upsertRows)
        .select()

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 })
      }

      // work_orders.bom_model を更新（引数で指定された場合）
      if (bom_model) {
        const { error: updateErr } = await supabase
          .from('work_orders')
          .update({ bom_model, cost_mode: 'bom', updated_at: now })
          .eq('id', work_order_id)

        // DBマイグレーション未反映環境では列更新をスキップ
        if (updateErr && !hasMissingColumnError(updateErr, 'bom_model') && !hasMissingColumnError(updateErr, 'cost_mode')) {
          return NextResponse.json({ error: updateErr.message }, { status: 500 })
        }
      }

      const total_cost = upsertRows.reduce((sum, r) => sum + r.subtotal, 0)

      return NextResponse.json({
        success: true,
        model,
        branch_count: upsertRows.length,
        total_cost,
        branches: inserted || [],
      })
    }

    // ---- action: upsert (手動調整) ----
    if (action === 'upsert') {
      const branches: any[] = body.branches || []
      if (!branches.length) {
        return NextResponse.json({ error: 'branches が空です' }, { status: 400 })
      }

      const { data: workOrderData, error: workOrderErr } = await supabase
        .from('work_orders')
        .select('order_no')
        .eq('id', work_order_id)
        .maybeSingle()

      if (workOrderErr) {
        return NextResponse.json({ error: workOrderErr.message }, { status: 500 })
      }

      const orderNo = String(workOrderData?.order_no || '').trim()
      if (!orderNo) {
        return NextResponse.json({ error: 'D指令番号が取得できませんでした' }, { status: 400 })
      }

      const rows = branches.map((b: any, index: number) => {
        const branchNo = String(b.branch_no || `B${String(index + 1).padStart(2, '0')}`)
        const rawPartKey = typeof b.part_key === 'string' ? b.part_key.trim() : ''
        const partKey = rawPartKey || `${orderNo}-${toPartKeyBranchNo(branchNo)}`

        return {
        work_order_id,
        branch_no: branchNo,
        part_key: partKey,
        part_name: b.part_name ?? null,
        product_code: b.product_code ?? null,
        bom_quantity: Number(b.bom_quantity ?? 1),
        unit_cost: Number(b.unit_cost ?? 0),
        subtotal: Math.round(Number(b.unit_cost ?? 0) * Number(b.bom_quantity ?? 1)),
        notes: b.notes ?? null,
        updated_at: new Date().toISOString(),
      }})

      const { data, error: upsertErr } = await supabase
        .from('work_order_branches')
        .upsert(rows, { onConflict: 'work_order_id,branch_no' })
        .select()

      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, branches: data || [] })
    }

    // ---- action: delete_branch (1件削除) ----
    if (action === 'delete_branch') {
      const branch_id: string = body.branch_id
      if (!branch_id) {
        return NextResponse.json({ error: 'branch_id は必須です' }, { status: 400 })
      }

      const { error: delErr } = await supabase
        .from('work_order_branches')
        .delete()
        .eq('id', branch_id)
        .eq('work_order_id', work_order_id) // 安全のため work_order_id も条件に追加

      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: '不明な action です' }, { status: 400 })
  } catch (err) {
    console.error('branches POST error:', err)
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }
}
