import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  inferProductCategory,
  normalizeProductCategory,
} from '@/lib/product-category'
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

  return {
    exists: Boolean(data),
    name: data?.name ?? null,
    category: normalizeProductCategory(
      data?.product_category || inferProductCategory(model, data?.name)
    ),
  }
}

/**
 * POST /api/heater/bom/copy
 * body: { source_model, target_model, mode?: 'merge' | 'replace' }
 *
 * 同一製品カテゴリの機種間のみ、BOM（＋グループ定義）をコピーする。
 * - merge（既定）: 既存の同一 part_key は数量・グループを上書き、無い行は追加
 * - replace: 先に target の BOM / グループを削除してから全コピー
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const sourceModel = String(body.source_model || '').trim()
    const targetModel = String(body.target_model || '').trim()
    const mode = body.mode === 'replace' ? 'replace' : 'merge'

    if (!sourceModel || !targetModel) {
      return NextResponse.json(
        { error: 'source_model と target_model が必要です' },
        { status: 400 }
      )
    }
    if (sourceModel === targetModel) {
      return NextResponse.json(
        { error: 'コピー元とコピー先が同じ機種です' },
        { status: 400 }
      )
    }

    const source = await getModelCategory(sourceModel)
    const target = await getModelCategory(targetModel)

    if (!source.exists) {
      return NextResponse.json(
        { error: `コピー元機種が見つかりません: ${sourceModel}` },
        { status: 404 }
      )
    }
    if (!target.exists) {
      return NextResponse.json(
        { error: `コピー先機種が見つかりません: ${targetModel}` },
        { status: 404 }
      )
    }
    if (source.category !== target.category) {
      return NextResponse.json(
        {
          error: `同一カテゴリの機種間のみコピーできます（元: ${source.category} / 先: ${target.category}）`,
          source_category: source.category,
          target_category: target.category,
        },
        { status: 400 }
      )
    }

    let sourceBom: any[] = []
    {
      const { data, error } = await supabase
        .from('heater_bom')
        .select('part_key, part_name, quantity, part_group, sort_order')
        .eq('model', sourceModel)
        .order('sort_order', { ascending: true })
        .order('part_key', { ascending: true })

      if (error && isMissingColumnError(error, 'part_group')) {
        const fb = await supabase
          .from('heater_bom')
          .select('part_key, part_name, quantity')
          .eq('model', sourceModel)
          .order('part_key', { ascending: true })
        if (fb.error) throw fb.error
        sourceBom = (fb.data || []).map((row, i) => ({
          ...row,
          part_group: null,
          sort_order: i,
        }))
      } else if (error) {
        throw error
      } else {
        sourceBom = data || []
      }
    }

    if (sourceBom.length === 0) {
      return NextResponse.json(
        { error: `コピー元 ${sourceModel} にBOMがありません` },
        { status: 400 }
      )
    }

    // グループ定義
    let sourceGroups: Array<{ group_name: string; sort_order: number }> = []
    {
      const { data, error } = await supabase
        .from('heater_bom_groups')
        .select('group_name, sort_order')
        .eq('model', sourceModel)
        .order('sort_order', { ascending: true })
      if (!error) {
        sourceGroups = (data || []).map((g) => ({
          group_name: String(g.group_name),
          sort_order: Number(g.sort_order ?? 0),
        }))
      }
    }

    if (mode === 'replace') {
      const { error: delBomError } = await supabase
        .from('heater_bom')
        .delete()
        .eq('model', targetModel)
      if (delBomError) throw delBomError

      const { error: delGroupError } = await supabase
        .from('heater_bom_groups')
        .delete()
        .eq('model', targetModel)
      if (
        delGroupError &&
        !String(delGroupError.message || '').includes('heater_bom_groups')
      ) {
        throw delGroupError
      }
    }

    // グループコピー
    let groupsCopied = 0
    if (sourceGroups.length > 0) {
      const payload = sourceGroups.map((g) => ({
        model: targetModel,
        group_name: g.group_name,
        sort_order: g.sort_order,
      }))
      const { error: groupError } = await supabase
        .from('heater_bom_groups')
        .upsert(payload, { onConflict: 'model,group_name' })
      if (
        groupError &&
        !String(groupError.message || '').includes('heater_bom_groups')
      ) {
        throw groupError
      }
      if (!groupError) groupsCopied = payload.length
    }

    const { data: existingTarget, error: existingError } = await supabase
      .from('heater_bom')
      .select('part_key')
      .eq('model', targetModel)
    if (existingError) throw existingError

    const existingKeys = new Set(
      (existingTarget || []).map((r) => String(r.part_key))
    )

    let created = 0
    let updated = 0

    for (const row of sourceBom) {
      const partKey = String(row.part_key || '').trim()
      if (!partKey) continue

      const payload: Record<string, unknown> = {
        model: targetModel,
        part_key: partKey,
        quantity: Number(row.quantity) > 0 ? Number(row.quantity) : 1,
      }
      if (row.part_name != null) payload.part_name = row.part_name
      if (row.part_group != null) payload.part_group = row.part_group
      if (row.sort_order != null) payload.sort_order = Number(row.sort_order) || 0

      if (existingKeys.has(partKey)) {
        const { error: updError } = await supabase
          .from('heater_bom')
          .update(payload)
          .eq('model', targetModel)
          .eq('part_key', partKey)
        if (updError) {
          // part_group 列なし環境向けフォールバック
          if (isMissingColumnError(updError, 'part_group')) {
            const { error: fbErr } = await supabase
              .from('heater_bom')
              .update({
                quantity: payload.quantity,
                part_name: payload.part_name ?? null,
              })
              .eq('model', targetModel)
              .eq('part_key', partKey)
            if (fbErr) throw fbErr
          } else {
            throw updError
          }
        }
        updated++
      } else {
        const { error: insError } = await supabase.from('heater_bom').insert([payload])
        if (insError) {
          if (isMissingColumnError(insError, 'part_group')) {
            const { error: fbErr } = await supabase.from('heater_bom').insert([
              {
                model: targetModel,
                part_key: partKey,
                quantity: payload.quantity,
                part_name: payload.part_name ?? null,
              },
            ])
            if (fbErr) throw fbErr
          } else {
            throw insError
          }
        }
        existingKeys.add(partKey)
        created++
      }
    }

    return NextResponse.json({
      success: true,
      source_model: sourceModel,
      target_model: targetModel,
      category: source.category,
      mode,
      source_rows: sourceBom.length,
      bom_created: created,
      bom_updated: updated,
      groups_copied: groupsCopied,
      message: `${sourceModel} → ${targetModel}（${source.category}）: 新規${created} / 更新${updated} / グループ${groupsCopied}`,
    })
  } catch (err) {
    console.error('bom copy error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'BOMコピーに失敗しました' },
      { status: 500 }
    )
  }
}
