import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type PartInput = {
  part_key?: string | null
  part_name?: string | null
  product_code?: string | null
  branch_no?: string | null
  bom_quantity?: number | string | null
}

function branchNoFor(index: number) {
  return `B${String(index + 1).padStart(2, '0')}`
}

function hasMissingColumnError(error: { message?: string } | null, column: string) {
  return Boolean(error?.message && error.message.includes(column))
}

/**
 * PUT /api/lines/[id]/branches
 * L指令の構成パーツをまとめて保存する。工費はパーツに持たせない。
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: lineId } = await params
    const body = await req.json()
    const lineCode = String(body?.line_code || '').trim()
    const parts = (Array.isArray(body?.parts) ? body.parts : []) as PartInput[]

    if (!lineId) {
      return NextResponse.json({ error: 'line_id がありません' }, { status: 400 })
    }
    if (!lineCode) {
      return NextResponse.json({ error: 'L指令コードがありません' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await supabase
      .from('line_part_assignments')
      .select('*')
      .eq('line_id', lineId)

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    const previousByKey = new Map(
      (existing || []).map((row) => [String(row.part_key || ''), row])
    )

    const normalized = parts
      .map((part, index) => {
        const branchNo = branchNoFor(index)
        const rawKey = String(part.part_key || '').trim()
        const partKey = rawKey || `${lineCode}-${String(index + 1).padStart(2, '0')}`
        const qty = Number(part.bom_quantity ?? 1)
        return {
          branch_no: branchNo,
          part_key: partKey,
          part_name: String(part.part_name || '').trim() || null,
          product_code: String(part.product_code || '').trim() || null,
          bom_quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        }
      })
      .filter((part, index, all) => all.findIndex((row) => row.part_key === part.part_key) === index)

    const now = new Date().toISOString()
    const rows = normalized.map((part) => {
      const previous = previousByKey.get(part.part_key)
      return {
        line_id: lineId,
        part_key: part.part_key,
        ratio: previous?.ratio ?? 100,
        branch_no: part.branch_no,
        part_name: part.part_name,
        product_code: part.product_code,
        bom_quantity: part.bom_quantity,
        common_group_label: previous?.common_group_label ?? null,
        allocation_models: previous?.allocation_models ?? null,
        bom_model_count: previous?.bom_model_count ?? null,
        common_group_source: previous?.common_group_source ?? 'manual',
        settings_confirmed: previous?.settings_confirmed ?? false,
        settings_confirmed_at: previous?.settings_confirmed_at ?? null,
        updated_at: now,
      }
    })

    if (rows.length > 0) {
      const upserted = await supabase
        .from('line_part_assignments')
        .upsert(rows, { onConflict: 'line_id,part_key' })
        .select()
      if (
        upserted.error &&
        (hasMissingColumnError(upserted.error, 'branch_no') ||
          hasMissingColumnError(upserted.error, 'part_name') ||
          hasMissingColumnError(upserted.error, 'bom_quantity'))
      ) {
        return NextResponse.json(
          {
            error:
              '構成パーツの列が未作成です。migrate-add-line-part-branch-fields.sql を実行してください。',
          },
          { status: 500 }
        )
      }
      if (upserted.error) {
        return NextResponse.json({ error: upserted.error.message }, { status: 500 })
      }
    }

    const keepKeys = new Set(normalized.map((part) => part.part_key))
    const removeIds = (existing || [])
      .filter((row) => !keepKeys.has(String(row.part_key || '')))
      .map((row) => row.id)
      .filter(Boolean)

    if (removeIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('line_part_assignments')
        .delete()
        .in('id', removeIds)
      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ parts: rows })
  } catch (err) {
    console.error('line branches put error:', err)
    return NextResponse.json({ error: '構成パーツの保存に失敗しました' }, { status: 500 })
  }
}
