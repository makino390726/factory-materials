import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/lines/[id]/part-assignments
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: lineId } = await params

    console.debug('GET assignment - lineId:', lineId)

    const { data: assignments, error } = await supabase
      .from('line_part_assignments')
      .select('*')
      .eq('line_id', lineId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('get assignments error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(assignments || [])
  } catch (err) {
    console.error('line part assignments get error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

// POST /api/lines/[id]/part-assignments - 割り当てを追加
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: lineId } = await params
    const body = await req.json()
    const {
      part_key,
      ratio,
      common_group_label,
      allocation_models,
      bom_model_count,
      common_group_source,
      settings_confirmed,
    } = body

    console.debug('POST assignment - lineId:', lineId, 'part_key:', part_key, 'ratio:', ratio)

    if (!lineId) {
      return NextResponse.json({ error: 'line_id not found in URL' }, { status: 400 })
    }

    if (!part_key) {
      return NextResponse.json({ error: 'part_key required' }, { status: 400 })
    }

    const ratioNum = Number(ratio) || 100
    const now = new Date().toISOString()
    const confirmed = Boolean(settings_confirmed)

    const { data, error } = await supabase
      .from('line_part_assignments')
      .insert([
        {
          line_id: lineId,
          part_key,
          ratio: ratioNum,
          common_group_label: common_group_label || null,
          allocation_models: allocation_models ?? null,
          bom_model_count:
            bom_model_count === undefined || bom_model_count === null
              ? null
              : Number(bom_model_count),
          common_group_source: common_group_source || 'bom_auto',
          settings_confirmed: confirmed,
          settings_confirmed_at: confirmed ? now : null,
          updated_at: now,
        },
      ])
      .select()

    if (error) {
      console.error('insert assignment error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (err) {
    console.error('line part assignments post error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

// PUT /api/lines/[id]/part-assignments - 割り当てを更新
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: lineId } = await params
    const body = await req.json()
    const {
      part_key,
      ratio,
      common_group_label,
      allocation_models,
      bom_model_count,
      common_group_source,
      settings_confirmed,
    } = body

    console.debug('PUT assignment - lineId:', lineId, 'part_key:', part_key, 'ratio:', ratio)

    if (!lineId) {
      return NextResponse.json({ error: 'line_id not found in URL' }, { status: 400 })
    }

    if (!part_key) {
      return NextResponse.json({ error: 'part_key required' }, { status: 400 })
    }

    const ratioNum = Number(ratio) || 100
    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      ratio: ratioNum,
      updated_at: now,
    }

    if (common_group_label !== undefined) {
      updatePayload.common_group_label = common_group_label || null
    }
    if (allocation_models !== undefined) {
      updatePayload.allocation_models = allocation_models
    }
    if (bom_model_count !== undefined) {
      updatePayload.bom_model_count =
        bom_model_count === null ? null : Number(bom_model_count)
    }
    if (common_group_source !== undefined) {
      updatePayload.common_group_source = common_group_source || 'bom_auto'
    }
    if (settings_confirmed !== undefined) {
      const confirmed = Boolean(settings_confirmed)
      updatePayload.settings_confirmed = confirmed
      updatePayload.settings_confirmed_at = confirmed ? now : null
    }

    const { data, error } = await supabase
      .from('line_part_assignments')
      .update(updatePayload)
      .eq('line_id', lineId)
      .eq('part_key', part_key)
      .select()

    if (error) {
      console.error('update assignment error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0] || { line_id: lineId, part_key, ratio: ratioNum })
  } catch (err) {
    console.error('line part assignments put error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

// DELETE /api/lines/[id]/part-assignments?part_key=xxx - 割り当てを削除
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: lineId } = await params
    const url = new URL(req.url)
    const partKey = url.searchParams.get('part_key')

    console.debug('DELETE assignment - lineId:', lineId, 'part_key:', partKey)

    if (!lineId) {
      return NextResponse.json({ error: 'line_id not found in URL' }, { status: 400 })
    }

    if (!partKey) {
      return NextResponse.json({ error: 'part_key required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('line_part_assignments')
      .delete()
      .eq('line_id', lineId)
      .eq('part_key', partKey)

    if (error) {
      console.error('delete assignment error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('line part assignments delete error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
