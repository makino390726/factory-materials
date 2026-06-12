import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseStandardDuration(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function hasMissingColumnError(error: any, columnName: string) {
  const msg = String(error?.message || '')
  return msg.includes(`Could not find the '${columnName}' column`)
}

function hasWorkOrdersCostColumnError(error: any) {
  return hasMissingColumnError(error, 'bom_model') || hasMissingColumnError(error, 'cost_mode')
}

async function syncWorkOrderBranchesFromBom(workOrderId: string, bomModel: string) {
  const { data: bomRows, error: bomError } = await supabase
    .from('heater_bom')
    .select('part_key, part_name, quantity')
    .eq('model', bomModel)
    .order('part_key')

  if (bomError) {
    throw new Error(`BOM取得エラー: ${bomError.message}`)
  }

  const partKeys = (bomRows || []).map((b: any) => b.part_key as string)

  let partsMap: Record<
    string,
    { part_name: string | null; product_code: string | null; cost_price: number }
  > = {}

  if (partKeys.length > 0) {
    const { data: partsData, error: partsError } = await supabase
      .from('heater_parts_master')
      .select('part_key, part_name, product_code, cost_price')
      .in('part_key', partKeys)

    if (partsError) {
      throw new Error(`パーツマスタ取得エラー: ${partsError.message}`)
    }

    for (const p of partsData || []) {
      partsMap[p.part_key] = {
        part_name: p.part_name ?? null,
        product_code: p.product_code ?? null,
        cost_price: Number(p.cost_price || 0),
      }
    }
  }

  const { error: deleteError } = await supabase
    .from('work_order_branches')
    .delete()
    .eq('work_order_id', workOrderId)

  if (deleteError) {
    throw new Error(`既存枝番削除エラー: ${deleteError.message}`)
  }

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
  if (insertError) {
    throw new Error(`枝番登録エラー: ${insertError.message}`)
  }

  const totalCost = branchRows.reduce((sum, row) => sum + row.subtotal, 0)
  return { branch_count: branchRows.length, total_cost: totalCost }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const orderNo = searchParams.get('orderNo')?.trim()
    const productName = searchParams.get('productName')?.trim()

    let query = supabase.from('work_orders').select('*')

    if (orderNo) {
      query = query.ilike('order_no', `%${orderNo}%`)
    }

    if (productName) {
      query = query.ilike('product_name', `%${productName}%`)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('作業指令取得エラー:', error)
    return NextResponse.json({ error: '作業指令取得に失敗しました' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      order_no,
      product_name,
      model,
      work_content,
      qty,
      status,
      completed,
      completed_date,
      standard_duration_minutes,
      cost_mode,
      bom_model,
    } = body
    const normalizedOrderNo = typeof order_no === 'string' ? order_no.trim() : ''
    const normalizedCostMode = cost_mode === 'bom' ? 'bom' : 'direct'
    const normalizedBomModel = normalizedCostMode === 'bom'
      ? normalizedOrderNo
      : (typeof bom_model === 'string' && bom_model.trim() ? bom_model.trim() : null)

    if (!normalizedOrderNo) {
      return NextResponse.json(
        { error: '作業指令番号は必須です' },
        { status: 400 }
      )
    }

    // 新規登録時点では完了状態を受け付けない
    if (status === '完了' || completed === true || completed_date) {
      return NextResponse.json(
        { error: '新規登録時点では完了を設定できません' },
        { status: 400 }
      )
    }

    // NOTE: allow duplicate order_no (same 指令番号で型式違いを管理したいため)
    // 以前は order_no の重複を拒否していたが、要件で同一指令番号で複数行を許可する。

    const basePayload = {
      order_no: normalizedOrderNo,
      product_name: product_name || null,
      model: model || null,
      work_content: work_content || null,
      qty: typeof qty === 'number' ? qty : null,
      status: status || null,
      completed: false,
      completed_date: null,
      // DB has NOT NULL constraint on standard_duration_minutes
      standard_duration_minutes: parseStandardDuration(standard_duration_minutes),
    }
    const extendedPayload = {
      ...basePayload,
      cost_mode: normalizedCostMode,
      bom_model: normalizedBomModel,
    }

    let data: any[] | null = null
    let error: any = null

    const primaryInsert = await supabase.from('work_orders').insert([extendedPayload]).select()
    data = primaryInsert.data
    error = primaryInsert.error

    // DBマイグレーション未反映環境向けフォールバック
    if (error && hasWorkOrdersCostColumnError(error)) {
      const fallbackInsert = await supabase.from('work_orders').insert([basePayload]).select()
      data = fallbackInsert.data
      error = fallbackInsert.error
    }

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const saved = data?.[0]
    if (!saved) {
      return NextResponse.json({ error: '作業指令登録結果が取得できませんでした' }, { status: 500 })
    }

    if (normalizedCostMode === 'bom' && normalizedBomModel) {
      const syncResult = await syncWorkOrderBranchesFromBom(saved.id, normalizedBomModel)
      return NextResponse.json({ ...saved, branch_sync: syncResult })
    }

    return NextResponse.json(saved)
  } catch (error) {
    console.error('作業指令登録エラー:', error)
    return NextResponse.json({ error: '作業指令登録に失敗しました' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const {
      id,
      order_no,
      product_name,
      model,
      work_content,
      qty,
      status,
      completed,
      completed_date,
      standard_duration_minutes,
      cost_mode,
      bom_model,
    } = body
    const normalizedOrderNo = typeof order_no === 'string' ? order_no.trim() : ''
    const normalizedCostMode = cost_mode === 'bom' ? 'bom' : 'direct'
    const normalizedBomModel = normalizedCostMode === 'bom'
      ? normalizedOrderNo
      : (typeof bom_model === 'string' && bom_model.trim() ? bom_model.trim() : null)

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    if (!normalizedOrderNo) {
      return NextResponse.json(
        { error: '作業指令番号は必須です' },
        { status: 400 }
      )
    }

    // NOTE: allow updating even if the target order_no exists on other rows.
    // 以前は同一の order_no が別の id に存在すると更新を拒否していたが、
    // 同一指令番号で複数型式を保持する要件に合わせてこのチェックを外す。

    const basePayload = {
      order_no: normalizedOrderNo,
      product_name: product_name || null,
      model: model || null,
      work_content: work_content || null,
      qty: typeof qty === 'number' ? qty : null,
      status: status || null,
      completed: typeof completed === 'boolean' ? completed : null,
      completed_date: completed_date || null,
      // Ensure NOT NULL column gets a number
      standard_duration_minutes: parseStandardDuration(standard_duration_minutes),
    }
    const extendedPayload = {
      ...basePayload,
      cost_mode: normalizedCostMode,
      bom_model: normalizedBomModel,
    }

    let data: any[] | null = null
    let error: any = null

    const primaryUpdate = await supabase
      .from('work_orders')
      .update(extendedPayload)
      .eq('id', id)
      .select()

    data = primaryUpdate.data
    error = primaryUpdate.error

    // DBマイグレーション未反映環境向けフォールバック
    if (error && hasWorkOrdersCostColumnError(error)) {
      const fallbackUpdate = await supabase
        .from('work_orders')
        .update(basePayload)
        .eq('id', id)
        .select()
      data = fallbackUpdate.data
      error = fallbackUpdate.error
    }

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const saved = data?.[0]
    if (!saved) {
      return NextResponse.json({ error: '作業指令更新結果が取得できませんでした' }, { status: 500 })
    }

    if (normalizedCostMode === 'bom' && normalizedBomModel) {
      const syncResult = await syncWorkOrderBranchesFromBom(id, normalizedBomModel)
      return NextResponse.json({ ...saved, branch_sync: syncResult })
    }

    // 直接原価に戻した場合は枝番をクリア
    await supabase.from('work_order_branches').delete().eq('work_order_id', id)

    return NextResponse.json(saved)
  } catch (error) {
    console.error('作業指令更新エラー:', error)
    return NextResponse.json({ error: '作業指令更新に失敗しました' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    const { error } = await supabase.from('work_orders').delete().eq('id', id)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('作業指令削除エラー:', error)
    return NextResponse.json({ error: '作業指令削除に失敗しました' }, { status: 500 })
  }
}
