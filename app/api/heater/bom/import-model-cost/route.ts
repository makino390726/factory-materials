import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { normalizeBomPartGroup, getDefaultBomGroupsForCategory } from '@/lib/heater-bom-part-group'
import { inferProductCategory, normalizeProductCategory } from '@/lib/product-category'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type CostLineRow = {
  component_name: string | null
  product_code: string | null
  part_name: string
  spec: string | null
  quantity: number
  unit_price: number
  material_cost: number
  labor_cost: number
  indirect_cost: number
  line_total: number
}

type PartGroup = {
  model: string
  part_key: string
  part_name: string
  part_group: string
  sort_order: number
  lines: CostLineRow[]
}

function buildLineOrderNo(partKey: string) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `LINE-${partKey}-${timestamp}`
}

function pickCell(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key]
    }
  }
  const entries = Object.entries(row)
  for (const key of keys) {
    const found = entries.find(([k]) => k.trim().toLowerCase() === key.trim().toLowerCase())
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') {
      return found[1]
    }
  }
  return undefined
}

function toText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function toNumber(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function normalizeGroups(
  data: Record<string, unknown>[],
  defaultModel: string,
  allowedGroupsByModel: Map<string, string[]>
): { groups: PartGroup[]; errors: string[]; models: string[] } {
  const groupMap = new Map<string, PartGroup>()
  const errors: string[] = []
  const modelSet = new Set<string>()
  const modelPartOrder = new Map<string, number>()

  for (let i = 0; i < data.length; i++) {
    const raw = data[i]
    const lineNo = i + 2

    const model =
      toText(pickCell(raw, ['機種', '機種コード', 'model', 'Model', '製品機種'])) ||
      defaultModel
    const partKey = toText(
      pickCell(raw, ['パーツキー', '部品キー', 'part_key', '図番', 'drawing', 'Drawing'])
    )
    const partName = toText(pickCell(raw, ['パーツ名', 'part_display_name', 'パーツ']))
    const csvPartGroup = toText(
      pickCell(raw, ['グループ', 'part_group', 'パーツグループ', '区分', '部品グループ'])
    )
    const componentName =
      toText(pickCell(raw, ['構成部品名', '構成部品', 'component_name', '構成要素', '備考'])) ||
      null
    const productCode =
      toText(
        pickCell(raw, [
          'コード',
          '製品コード',
          '商品コード',
          'product_code',
          '品番',
        ])
      ) || null
    const itemPartName = toText(
      pickCell(raw, ['品名', '部品名', 'part_name', 'name', '名称'])
    )
    const spec = toText(pickCell(raw, ['規格', 'spec', '仕様'])) || null
    const quantity = toNumber(
      pickCell(raw, ['数量', '必要数', 'quantity', 'qty', '1台当たり必要数'])
    )
    const unitPrice = toNumber(
      pickCell(raw, ['単価', '原価単価', 'unit_cost', 'unit_price', '仕入単価'])
    )
    const materialCost = toNumber(pickCell(raw, ['材料費', 'material_cost', '材料']))
    const laborCost = toNumber(pickCell(raw, ['工賃', '工費', 'labor_cost', 'labor']))
    const indirectCost = toNumber(pickCell(raw, ['間接費', 'indirect_cost', '間接']))
    // 合計欄は欠落・古い値のことがあるため、常にシステムで再計算する
    const lineTotal = materialCost + laborCost + indirectCost

    if (!model) {
      errors.push(
        `${lineNo}行目: 機種がありません（画面で機種選択するか、CSVに機種列を入れてください）`
      )
      continue
    }
    if (!partKey) {
      errors.push(`${lineNo}行目: パーツキー（部品キー）がありません`)
      continue
    }
    if (!partName) {
      errors.push(`${lineNo}行目: パーツ名がありません（パーツキー: ${partKey}）`)
      continue
    }
    if (!itemPartName && !componentName && !productCode && lineTotal === 0) {
      // 空行スキップ
      continue
    }
    if (!itemPartName) {
      errors.push(
        `${lineNo}行目: 品名（部品名）がありません（パーツキー: ${partKey}）`
      )
      continue
    }

    modelSet.add(model)
    const groupKey = `${model}\0${partKey}`
    let group = groupMap.get(groupKey)
    if (!group) {
      const orderKey = model
      const nextOrder = modelPartOrder.get(orderKey) ?? 0
      modelPartOrder.set(orderKey, nextOrder + 1)
      group = {
        model,
        part_key: partKey,
        part_name: partName,
        part_group: normalizeBomPartGroup(
          csvPartGroup,
          partKey,
          partName,
          allowedGroupsByModel.get(model) || []
        ),
        sort_order: nextOrder,
        lines: [],
      }
      groupMap.set(groupKey, group)
    } else if (partName && group.part_name !== partName) {
      // 同一キーでパーツ名が違う場合は後勝ちで上書き
      group.part_name = partName
    }

    group.lines.push({
      component_name: componentName,
      product_code: productCode,
      part_name: itemPartName,
      spec,
      quantity: quantity > 0 ? quantity : 1,
      unit_price: unitPrice,
      material_cost: materialCost,
      labor_cost: laborCost,
      indirect_cost: indirectCost,
      line_total: lineTotal,
    })
  }

  return {
    groups: Array.from(groupMap.values()),
    errors,
    models: Array.from(modelSet),
  }
}

/**
 * POST /api/heater/bom/import-model-cost
 *
 * 列振り分け:
 * - パーツ一覧(BOM/パーツマスタ): 機種, パーツキー(部品キー), パーツ名, グループ(任意)  ※BOM数量は常に1
 * - 原価計算明細: 構成部品名, コード(製品コード), 品名(部品名), 規格, 数量, 単価, 材料費, 工賃, 間接費
 * - 行合計は CSV の合計列を使わず、材料費+工賃+間接費で常に再計算する
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const defaultModel = String(formData.get('model') || '').trim()

    if (!file) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return NextResponse.json({ error: 'シートが見つかりません' }, { status: 400 })
    }
    const worksheet = workbook.Sheets[sheetName]
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as Record<
      string,
      unknown
    >[]
    if (!rawData.length) {
      return NextResponse.json({ error: 'データ行がありません' }, { status: 400 })
    }

    const normalizedData = rawData.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        out[String(k).trim()] = v
      }
      return out
    })

    const allowedGroupsByModel = new Map<string, string[]>()
    const groupSeedErrors: string[] = []
    const modelsInFile = new Set<string>()
    for (const row of normalizedData) {
      const m =
        toText(pickCell(row, ['機種', '機種コード', 'model', 'Model', '製品機種'])) ||
        defaultModel
      if (m) modelsInFile.add(m)
    }

    for (const model of modelsInFile) {
      const { data: groupRows } = await supabase
        .from('heater_bom_groups')
        .select('group_name, sort_order')
        .eq('model', model)
        .order('sort_order', { ascending: true })
      if (groupRows && groupRows.length > 0) {
        allowedGroupsByModel.set(
          model,
          groupRows.map((g) => String(g.group_name))
        )
        continue
      }
      const { data: modelRow } = await supabase
        .from('heater_models')
        .select('name, product_category')
        .eq('model', model)
        .maybeSingle()
      const category = normalizeProductCategory(
        modelRow?.product_category || inferProductCategory(model, modelRow?.name)
      )
      const defaults = getDefaultBomGroupsForCategory(category)
      allowedGroupsByModel.set(model, defaults.map((g) => g.group_name))
      const { error: seedError } = await supabase.from('heater_bom_groups').upsert(
        defaults.map((g) => ({
          model,
          group_name: g.group_name,
          sort_order: g.sort_order,
        })),
        { onConflict: 'model,group_name', ignoreDuplicates: true }
      )
      if (seedError && !String(seedError.message).includes('heater_bom_groups')) {
        groupSeedErrors.push(`グループ初期化失敗 ${model}: ${seedError.message}`)
      }
    }

    const { groups, errors, models } = normalizeGroups(
      normalizedData,
      defaultModel,
      allowedGroupsByModel
    )
    if (groups.length === 0) {
      return NextResponse.json(
        {
          error: '取込可能な行がありません',
          errors: errors.slice(0, 50),
          headers: Object.keys(normalizedData[0] || {}),
        },
        { status: 400 }
      )
    }

    let partsCreated = 0
    let partsUpdated = 0
    let bomCreated = 0
    let bomUpdated = 0
    let costItemsImported = 0
    const rowErrors = [...errors, ...groupSeedErrors]

    // 機種マスタへ不足分を追加（ドロップダウン表示用）。カテゴリも推定して登録／補完する
    for (const model of models) {
      const inferredCategory = inferProductCategory(model, model)
      const { data: existingModel } = await supabase
        .from('heater_models')
        .select('model, name, product_category')
        .eq('model', model)
        .maybeSingle()
      if (!existingModel) {
        const { error } = await supabase.from('heater_models').insert([
          {
            model,
            name: model,
            product_category: inferredCategory,
          },
        ])
        if (error && !String(error.message || '').includes('duplicate')) {
          rowErrors.push(`機種マスタ登録失敗 ${model}: ${error.message}`)
        }
        continue
      }

      const currentCategory = String(existingModel.product_category || '').trim()
      if (!currentCategory) {
        const { error } = await supabase
          .from('heater_models')
          .update({ product_category: inferredCategory })
          .eq('model', model)
        if (error && !String(error.message || '').includes('product_category')) {
          rowErrors.push(`機種カテゴリ補完失敗 ${model}: ${error.message}`)
        }
      }
    }

    const uniquePartKeys = [...new Set(groups.map((g) => g.part_key))]
    const existingPartKeys = new Set<string>()
    for (let i = 0; i < uniquePartKeys.length; i += 200) {
      const chunk = uniquePartKeys.slice(i, i + 200)
      const { data, error } = await supabase
        .from('heater_parts_master')
        .select('part_key')
        .in('part_key', chunk)
      if (error) throw error
      for (const p of data || []) existingPartKeys.add(String(p.part_key))
    }

    for (const group of groups) {
      try {
        const totalMaterial = group.lines.reduce((s, r) => s + r.material_cost, 0)
        const totalLabor = group.lines.reduce((s, r) => s + r.labor_cost, 0)
        const totalIndirect = group.lines.reduce((s, r) => s + r.indirect_cost, 0)
        const totalCost = group.lines.reduce((s, r) => s + r.line_total, 0)

        // --- パーツ一覧反映（パーツキー / パーツ名、数量は常に1） ---
        if (existingPartKeys.has(group.part_key)) {
          const { error } = await supabase
            .from('heater_parts_master')
            .update({
              part_name: group.part_name,
              cost_price: totalCost,
              material_cost_total: totalMaterial > 0 ? totalMaterial : null,
              indirect_cost_total: totalIndirect > 0 ? totalIndirect : null,
            })
            .eq('part_key', group.part_key)
          if (error) throw error
          partsUpdated++
        } else {
          const { error } = await supabase.from('heater_parts_master').insert([
            {
              part_key: group.part_key,
              part_name: group.part_name,
              product_code: null,
              spec: null,
              cost_price: totalCost,
              material_cost_total: totalMaterial > 0 ? totalMaterial : null,
              indirect_cost_total: totalIndirect > 0 ? totalIndirect : null,
              shelf_no: null,
            },
          ])
          if (error) throw error
          existingPartKeys.add(group.part_key)
          partsCreated++
        }

        const { data: existingBom, error: bomFindError } = await supabase
          .from('heater_bom')
          .select('model, part_key')
          .eq('model', group.model)
          .eq('part_key', group.part_key)
          .maybeSingle()
        if (bomFindError) throw bomFindError

        if (existingBom) {
          const { error } = await supabase
            .from('heater_bom')
            .update({
              quantity: 1,
              part_group: group.part_group,
              sort_order: group.sort_order,
            })
            .eq('model', group.model)
            .eq('part_key', group.part_key)
          if (error) throw error
          bomUpdated++
        } else {
          const { error } = await supabase.from('heater_bom').insert([
            {
              model: group.model,
              part_key: group.part_key,
              quantity: 1,
              part_group: group.part_group,
              sort_order: group.sort_order,
            },
          ])
          if (error) throw error
          bomCreated++
        }

        // --- 原価計算欄反映（構成部品・コード・品名・規格・数量・単価・費用） ---
        const { data: existingCostItems, error: existingCostError } = await supabase
          .from('work_order_cost_items')
          .select('id, work_order_cost_id')
          .eq('master_type', 'ライン原価')
          .eq('master_id', group.part_key)
          .limit(1)
        if (existingCostError) throw existingCostError

        let workOrderCostId = String(existingCostItems?.[0]?.work_order_cost_id || '')
        const { error: deleteItemsError } = await supabase
          .from('work_order_cost_items')
          .delete()
          .eq('master_type', 'ライン原価')
          .eq('master_id', group.part_key)
        if (deleteItemsError) throw deleteItemsError

        if (workOrderCostId) {
          const { error: headerUpdateError } = await supabase
            .from('work_order_costs')
            .update({
              total_material_cost: totalMaterial,
              total_labor_cost: totalLabor,
              total_indirect_cost: totalIndirect,
              total_cost: totalCost,
            })
            .eq('id', workOrderCostId)
          if (headerUpdateError) throw headerUpdateError
        } else {
          const { data: createdHeader, error: headerInsertError } = await supabase
            .from('work_order_costs')
            .insert([
              {
                order_no: buildLineOrderNo(group.part_key),
                work_order_id: null,
                total_material_cost: totalMaterial,
                total_labor_cost: totalLabor,
                total_indirect_cost: totalIndirect,
                total_cost: totalCost,
                notes: `imported model-cost ${group.model}/${group.part_key}`,
              },
            ])
            .select('id')
            .single()
          if (headerInsertError || !createdHeader?.id) {
            throw new Error(headerInsertError?.message || '原価ヘッダの作成に失敗しました')
          }
          workOrderCostId = String(createdHeader.id)
        }

        const itemsPayload = group.lines.map((row, idx) => ({
          work_order_cost_id: workOrderCostId,
          line_no: idx + 1,
          component_name: row.component_name,
          product_code: row.product_code,
          part_name: row.part_name,
          spec: row.spec,
          quantity: row.quantity,
          unit_price: row.unit_price,
          material_cost: row.material_cost,
          labor_cost: row.labor_cost,
          indirect_cost: row.indirect_cost,
          line_total: row.line_total,
          cost_type: '加',
          master_type: 'ライン原価',
          master_id: group.part_key,
        }))

        const { error: itemsInsertError } = await supabase
          .from('work_order_cost_items')
          .insert(itemsPayload)
        if (itemsInsertError) throw itemsInsertError
        costItemsImported += itemsPayload.length
      } catch (e) {
        rowErrors.push(
          `${group.model}/${group.part_key}: ${
            e instanceof Error ? e.message : '処理に失敗しました'
          }`
        )
      }
    }

    return NextResponse.json({
      success: true,
      message: '機種別原価Excel取込が完了しました',
      total_rows: normalizedData.length,
      imported_rows: groups.reduce((s, g) => s + g.lines.length, 0),
      parts_count: groups.length,
      parts_created: partsCreated,
      parts_updated: partsUpdated,
      bom_created: bomCreated,
      bom_updated: bomUpdated,
      cost_items_imported: costItemsImported,
      models,
      error_count: rowErrors.length,
      errors: rowErrors.slice(0, 100),
    })
  } catch (err) {
    console.error('import-model-cost error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '取込に失敗しました' },
      { status: 500 }
    )
  }
}
