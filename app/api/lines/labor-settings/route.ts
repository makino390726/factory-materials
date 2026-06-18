import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  bulkRecalculateConfirmedAssignments,
  buildLaborRecalcPreview,
  type LinePartAssignmentRow,
  type LineRow,
} from '@/lib/line-part-labor-cost'
import { getPartCommonalityFromBom } from '@/lib/part-commonality'
import {
  formatPostgrestError,
  isMissingColumnError,
  LINE_PART_COMMON_GROUP_MIGRATION_HINT,
} from '@/lib/supabase-error'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function ensureLaborSettingsSchema() {
  const { error } = await supabase
    .from('line_part_assignments')
    .select('common_group_label, allocation_models, settings_confirmed')
    .limit(0)

  if (error && isMissingColumnError(error, 'common_group_label')) {
    return {
      ok: false as const,
      error: `共通明細用のDBカラムがありません。${LINE_PART_COMMON_GROUP_MIGRATION_HINT}`,
    }
  }

  if (error) {
    throw error
  }

  return { ok: true as const }
}

/** GET: 全ラインパーツ割り当ての按分設定一覧（プレビュー付き） */
export async function GET(req: NextRequest) {
  try {
    const schema = await ensureLaborSettingsSchema()
    if (!schema.ok) {
      return NextResponse.json({ error: schema.error }, { status: 500 })
    }

    const planId = req.nextUrl.searchParams.get('plan_id')?.trim() || null

    const { data: assignments, error: assignmentError } = await supabase
      .from('line_part_assignments')
      .select('*')
      .order('part_key', { ascending: true })

    if (assignmentError) {
      throw assignmentError
    }

    const lineIds = [...new Set((assignments || []).map((row) => row.line_id))]
    const { data: lines, error: lineError } = await supabase
      .from('lines')
      .select('id, line_code, name, standard_duration_minutes')
      .in('id', lineIds.length > 0 ? lineIds : ['00000000-0000-0000-0000-000000000000'])

    if (lineError) throw lineError

    const lineMap = new Map((lines || []).map((line) => [line.id, line as LineRow]))
    const rows = []

    for (const assignment of assignments || []) {
      const line = lineMap.get(assignment.line_id)
      if (!line) continue

      const preview = await buildLaborRecalcPreview(
        supabase,
        assignment as LinePartAssignmentRow,
        line,
        planId
      )

      rows.push({
        assignment_id: assignment.id,
        line_id: assignment.line_id,
        line_code: line.line_code,
        line_name: line.name,
        part_key: assignment.part_key,
        ratio: assignment.ratio,
        common_group_label: assignment.common_group_label,
        allocation_models: assignment.allocation_models,
        bom_model_count: assignment.bom_model_count,
        common_group_source: assignment.common_group_source,
        settings_confirmed: Boolean(assignment.settings_confirmed),
        settings_confirmed_at: assignment.settings_confirmed_at,
        labor_recalc_at: assignment.labor_recalc_at,
        preview,
      })
    }

    return NextResponse.json({
      total: rows.length,
      confirmed_count: rows.filter((row) => row.settings_confirmed).length,
      rows,
    })
  } catch (err) {
    console.error('labor-settings GET error:', err)
    return NextResponse.json(
      { error: formatPostgrestError(err, '取得に失敗しました') },
      { status: 500 }
    )
  }
}

/** POST: 確認済み割り当ての労賃を一括再計算 */
export async function POST(req: NextRequest) {
  try {
    const schema = await ensureLaborSettingsSchema()
    if (!schema.ok) {
      return NextResponse.json({ error: schema.error }, { status: 500 })
    }

    const body = await req.json().catch(() => ({}))
    const planId = typeof body?.plan_id === 'string' ? body.plan_id : null
    const onlyConfirmed = body?.only_confirmed !== false

    const summary = await bulkRecalculateConfirmedAssignments(supabase, {
      planId,
      onlyConfirmed,
    })

    return NextResponse.json(summary)
  } catch (err) {
    console.error('labor-settings POST error:', err)
    return NextResponse.json(
      { error: formatPostgrestError(err, '一括再計算に失敗しました') },
      { status: 500 }
    )
  }
}

/** PATCH: BOMから共通明細を一括再検出 */
export async function PATCH() {
  try {
    const schema = await ensureLaborSettingsSchema()
    if (!schema.ok) {
      return NextResponse.json({ error: schema.error }, { status: 500 })
    }

    const { data: assignments, error } = await supabase.from('line_part_assignments').select('*')

    if (error) throw error

    let updated = 0
    for (const assignment of assignments || []) {
      const commonality = await getPartCommonalityFromBom(supabase, assignment.part_key)
      const preserveManual = assignment.common_group_source === 'manual'

      const { error: updateError } = await supabase
        .from('line_part_assignments')
        .update({
          bom_model_count: commonality.bom_model_count,
          ...(preserveManual
            ? {}
            : {
                common_group_label: commonality.common_group_label,
                allocation_models: commonality.models,
                common_group_source: 'bom_auto',
              }),
          settings_confirmed: false,
          settings_confirmed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', assignment.id)

      if (updateError) throw updateError
      updated += 1
    }

    return NextResponse.json({ success: true, updated_count: updated })
  } catch (err) {
    console.error('labor-settings PATCH error:', err)
    return NextResponse.json(
      { error: formatPostgrestError(err, 'BOM再検出に失敗しました') },
      { status: 500 }
    )
  }
}
