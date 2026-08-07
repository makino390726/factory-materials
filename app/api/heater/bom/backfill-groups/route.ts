import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  buildGroupSortMap,
  getDefaultBomGroupsForCategory,
  inferBomPartGroup,
  sortBomPartRowsWithGroups,
  UNCATEGORIZED_BOM_GROUP,
} from '@/lib/heater-bom-part-group'
import { inferProductCategory, normalizeProductCategory } from '@/lib/product-category'
import { isMissingColumnError } from '@/lib/supabase-error'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getModelGroupNames(model: string): Promise<string[]> {
  const { data: groupRows } = await supabase
    .from('heater_bom_groups')
    .select('group_name')
    .eq('model', model)
    .order('sort_order', { ascending: true })

  if (groupRows && groupRows.length > 0) {
    return groupRows.map((g) => String(g.group_name))
  }

  const { data: modelRow } = await supabase
    .from('heater_models')
    .select('name, product_category')
    .eq('model', model)
    .maybeSingle()

  const category = normalizeProductCategory(
    modelRow?.product_category || inferProductCategory(model, modelRow?.name)
  )
  return getDefaultBomGroupsForCategory(category).map((g) => g.group_name)
}

/**
 * POST /api/heater/bom/backfill-groups?model=SP-60S-3T
 * 未設定の part_group をパーツ名から推定して保存する
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const model = url.searchParams.get('model')?.trim()
    if (!model) {
      return NextResponse.json({ error: 'model パラメータが必要です' }, { status: 400 })
    }

    const allowedGroups = await getModelGroupNames(model)
    const { data: groupRows } = await supabase
      .from('heater_bom_groups')
      .select('group_name, sort_order')
      .eq('model', model)
      .order('sort_order', { ascending: true })

    const groupSortMap = buildGroupSortMap(
      (groupRows || []).map((g, i) => ({
        group_name: String(g.group_name),
        sort_order: Number(g.sort_order ?? i),
      }))
    )

    const { data: bomRows, error: bomError } = await supabase
      .from('heater_bom')
      .select('model, part_key, part_name, part_group, sort_order')
      .eq('model', model)

    if (bomError) {
      if (isMissingColumnError(bomError, 'part_group')) {
        return NextResponse.json(
          {
            error:
              'part_group 列がありません。Supabase で migrate-add-heater-bom-part-group.sql を実行してください。',
          },
          { status: 400 }
        )
      }
      throw bomError
    }

    const rows = sortBomPartRowsWithGroups(
      (bomRows || []).map((row) => ({
        ...row,
        part_group:
          String(row.part_group || '').trim() ||
          inferBomPartGroup(String(row.part_key || ''), row.part_name, allowedGroups),
      })),
      groupSortMap
    )

    const grouped = new Map<string, typeof rows>()
    for (const row of rows) {
      const groupName = String(row.part_group || UNCATEGORIZED_BOM_GROUP)
      const list = grouped.get(groupName) ?? []
      list.push(row)
      grouped.set(groupName, list)
    }

    let updated = 0
    for (const [groupName, parts] of grouped.entries()) {
      const sortedParts = [...parts].sort((a, b) =>
        String(a.part_key || '').localeCompare(String(b.part_key || ''), 'ja-JP')
      )

      for (let idx = 0; idx < sortedParts.length; idx++) {
        const row = sortedParts[idx]
        const currentGroup = String(row.part_group || '').trim()
        const currentOrder = Number(row.sort_order ?? -1)
        const targetGroup = groupName
        const targetOrder = idx

        if (currentGroup === targetGroup && currentOrder === targetOrder) continue

        const { error: updateError } = await supabase
          .from('heater_bom')
          .update({
            part_group: targetGroup,
            sort_order: targetOrder,
          })
          .eq('model', model)
          .eq('part_key', row.part_key)

        if (updateError) throw updateError
        updated++
      }
    }

    return NextResponse.json({
      success: true,
      model,
      total: rows.length,
      updated,
    })
  } catch (err) {
    console.error('backfill-groups error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'グループ自動設定に失敗しました' },
      { status: 500 }
    )
  }
}
