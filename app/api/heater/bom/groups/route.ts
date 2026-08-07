import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getDefaultBomGroupsForCategory,
  type BomGroupDefinition,
  UNCATEGORIZED_BOM_GROUP,
} from '@/lib/heater-bom-part-group'
import { inferProductCategory, normalizeProductCategory } from '@/lib/product-category'
import { isMissingColumnError } from '@/lib/supabase-error'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getModelCategory(model: string) {
  const { data } = await supabase
    .from('heater_models')
    .select('model, name, product_category')
    .eq('model', model)
    .maybeSingle()

  return normalizeProductCategory(
    data?.product_category || inferProductCategory(String(data?.model || model), data?.name)
  )
}

async function fetchGroups(model: string): Promise<BomGroupDefinition[]> {
  const { data, error } = await supabase
    .from('heater_bom_groups')
    .select('group_name, sort_order')
    .eq('model', model)
    .order('sort_order', { ascending: true })
    .order('group_name', { ascending: true })

  if (error) {
    if (isMissingColumnError(error, 'heater_bom_groups') || error.message?.includes('heater_bom_groups')) {
      return []
    }
    throw error
  }
  return (data || []).map((row) => ({
    group_name: String(row.group_name),
    sort_order: Number(row.sort_order ?? 0),
  }))
}

async function ensureDefaultGroups(model: string): Promise<BomGroupDefinition[]> {
  const existing = await fetchGroups(model)
  if (existing.length > 0) return existing

  const category = await getModelCategory(model)
  const defaults = getDefaultBomGroupsForCategory(category)

  const { error } = await supabase.from('heater_bom_groups').insert(
    defaults.map((g) => ({
      model,
      group_name: g.group_name,
      sort_order: g.sort_order,
    }))
  )

  if (error) {
    if (error.message?.includes('heater_bom_groups')) return defaults
    throw error
  }

  return defaults
}

/** GET /api/heater/bom/groups?model=SP-60S-3T */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const model = url.searchParams.get('model')?.trim()
    if (!model) {
      return NextResponse.json({ error: 'model パラメータが必要です' }, { status: 400 })
    }

    const seed = url.searchParams.get('seed') !== 'false'
    const category = await getModelCategory(model)
    const groups = seed ? await ensureDefaultGroups(model) : await fetchGroups(model)

    return NextResponse.json({
      model,
      product_category: category,
      groups,
    })
  } catch (err) {
    console.error('bom groups GET error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'グループ取得に失敗しました' },
      { status: 500 }
    )
  }
}

/** POST { model, group_name } — グループ追加 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const model = String(body.model || '').trim()
    const group_name = String(body.group_name || '').trim()
    if (!model || !group_name) {
      return NextResponse.json({ error: 'model と group_name が必要です' }, { status: 400 })
    }
    if (group_name === UNCATEGORIZED_BOM_GROUP) {
      return NextResponse.json({ error: '「未分類」は追加できません' }, { status: 400 })
    }

    const existing = await fetchGroups(model)
    if (existing.some((g) => g.group_name === group_name)) {
      return NextResponse.json({ error: '同名のグループが既にあります' }, { status: 409 })
    }

    const sort_order =
      existing.length > 0 ? Math.max(...existing.map((g) => g.sort_order)) + 1 : 0

    const { data, error } = await supabase
      .from('heater_bom_groups')
      .insert([{ model, group_name, sort_order }])
      .select('group_name, sort_order')
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    console.error('bom groups POST error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'グループ追加に失敗しました' },
      { status: 500 }
    )
  }
}

/** PUT { model, old_name, new_name } — グループ名変更（BOMの part_group も更新） */
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const model = String(body.model || '').trim()
    const old_name = String(body.old_name || body.group_name || '').trim()
    const new_name = String(body.new_name || '').trim()

    if (!model || !old_name || !new_name) {
      return NextResponse.json({ error: 'model, old_name, new_name が必要です' }, { status: 400 })
    }
    if (new_name === UNCATEGORIZED_BOM_GROUP) {
      return NextResponse.json({ error: '「未分類」へのリネームはできません' }, { status: 400 })
    }
    if (old_name === new_name) {
      return NextResponse.json({ success: true, renamed: false })
    }

    const row = await supabase
      .from('heater_bom_groups')
      .select('sort_order')
      .eq('model', model)
      .eq('group_name', old_name)
      .maybeSingle()

    if (!row.data) {
      return NextResponse.json({ error: 'グループが見つかりません' }, { status: 404 })
    }

    const conflict = await supabase
      .from('heater_bom_groups')
      .select('group_name')
      .eq('model', model)
      .eq('group_name', new_name)
      .maybeSingle()
    if (conflict.data) {
      return NextResponse.json({ error: '変更先のグループ名が既に存在します' }, { status: 409 })
    }

    const { error: delError } = await supabase
      .from('heater_bom_groups')
      .delete()
      .eq('model', model)
      .eq('group_name', old_name)
    if (delError) throw delError

    const { error: insError } = await supabase.from('heater_bom_groups').insert([
      {
        model,
        group_name: new_name,
        sort_order: row.data.sort_order,
      },
    ])
    if (insError) throw insError

    const { error: bomError } = await supabase
      .from('heater_bom')
      .update({ part_group: new_name })
      .eq('model', model)
      .eq('part_group', old_name)
    if (bomError && !isMissingColumnError(bomError, 'part_group')) throw bomError

    return NextResponse.json({ success: true, renamed: true, old_name, new_name })
  } catch (err) {
    console.error('bom groups PUT error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'グループ名変更に失敗しました' },
      { status: 500 }
    )
  }
}

/** DELETE ?model=&group_name= */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const model = url.searchParams.get('model')?.trim()
    const group_name = url.searchParams.get('group_name')?.trim()
    if (!model || !group_name) {
      return NextResponse.json({ error: 'model と group_name が必要です' }, { status: 400 })
    }
    if (group_name === UNCATEGORIZED_BOM_GROUP) {
      return NextResponse.json({ error: '「未分類」は削除できません' }, { status: 400 })
    }

    const { error: bomError } = await supabase
      .from('heater_bom')
      .update({ part_group: UNCATEGORIZED_BOM_GROUP })
      .eq('model', model)
      .eq('part_group', group_name)
    if (bomError && !isMissingColumnError(bomError, 'part_group')) throw bomError

    const { error } = await supabase
      .from('heater_bom_groups')
      .delete()
      .eq('model', model)
      .eq('group_name', group_name)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('bom groups DELETE error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'グループ削除に失敗しました' },
      { status: 500 }
    )
  }
}
