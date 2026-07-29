import type { SupabaseClient } from '@supabase/supabase-js'

export type WorkOrderCostTemplateInfo = {
  work_order_id: string
  order_no: string
  product_name: string | null
  model: string | null
  bom_model: string | null
  cost_mode: string | null
  is_cost_template: boolean
  has_saved_cost: boolean
  total_cost: number
  updated_at: string | null
}

function normalizeKey(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()
}

export function buildProductCostMatchKey(input: {
  product_name?: string | null
  bom_model?: string | null
  model?: string | null
}) {
  const product = normalizeKey(input.product_name)
  const bom = normalizeKey(input.bom_model)
  const model = normalizeKey(input.model)
  if (product && bom) return `${product}|bom:${bom}`
  if (product && model) return `${product}|model:${model}`
  if (product) return product
  if (bom) return `bom:${bom}`
  if (model) return `model:${model}`
  return ''
}

function remapMasterId(
  masterId: string | null | undefined,
  sourceOrderNo: string,
  targetOrderNo: string
): string {
  const id = String(masterId || '').trim()
  if (!id || !sourceOrderNo || !targetOrderNo) return id
  if (id === sourceOrderNo) return targetOrderNo
  if (id.startsWith(`${sourceOrderNo}-`)) {
    return `${targetOrderNo}${id.slice(sourceOrderNo.length)}`
  }
  return id
}

async function loadLatestSavedCost(
  supabase: SupabaseClient,
  workOrderId: string
) {
  const { data, error } = await supabase
    .from('work_order_costs')
    .select(
      'id, work_order_id, order_no, total_cost, total_material_cost, total_labor_cost, total_indirect_cost, cost_mode, updated_at, created_at'
    )
    .eq('work_order_id', workOrderId)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/** 制作D指令に対する原価テンプレート候補を検索 */
export async function findCostTemplateForWorkOrder(
  supabase: SupabaseClient,
  workOrderId: string
): Promise<WorkOrderCostTemplateInfo | null> {
  const { data: target, error: targetError } = await supabase
    .from('work_orders')
    .select(
      'id, order_no, product_name, model, bom_model, cost_mode, is_cost_template, cost_template_work_order_id'
    )
    .eq('id', workOrderId)
    .maybeSingle()
  if (targetError) throw targetError
  if (!target) return null

  const explicitId = target.cost_template_work_order_id
    ? String(target.cost_template_work_order_id)
    : ''
  if (explicitId && explicitId !== workOrderId) {
    const info = await toTemplateInfo(supabase, explicitId)
    if (info) return info
  }

  const matchKey = buildProductCostMatchKey(target)
  if (!matchKey) return null

  const { data: templates, error: templateError } = await supabase
    .from('work_orders')
    .select('id, order_no, product_name, model, bom_model, cost_mode, is_cost_template')
    .eq('is_cost_template', true)
    .neq('id', workOrderId)
    .order('updated_at', { ascending: false })
  if (templateError) {
    if (templateError.message?.includes('is_cost_template')) return null
    throw templateError
  }

  const matched = (templates || []).filter(
    (row) => buildProductCostMatchKey(row) === matchKey
  )
  for (const row of matched) {
    const info = await toTemplateInfo(supabase, String(row.id))
    if (info?.has_saved_cost) return info
  }

  const { data: savedList } = await supabase
    .from('work_order_costs')
    .select('work_order_id, total_cost, updated_at, created_at')
    .not('work_order_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(200)

  const seen = new Set<string>()
  for (const costRow of savedList || []) {
    const id = String(costRow.work_order_id || '')
    if (!id || id === workOrderId || seen.has(id)) continue
    seen.add(id)
    const { data: order } = await supabase
      .from('work_orders')
      .select('id, order_no, product_name, model, bom_model, cost_mode, is_cost_template')
      .eq('id', id)
      .maybeSingle()
    if (!order) continue
    if (buildProductCostMatchKey(order) !== matchKey) continue
    const info = await toTemplateInfo(supabase, id)
    if (info?.has_saved_cost) return info
  }

  return null
}

async function toTemplateInfo(
  supabase: SupabaseClient,
  workOrderId: string
): Promise<WorkOrderCostTemplateInfo | null> {
  const { data: order, error } = await supabase
    .from('work_orders')
    .select('id, order_no, product_name, model, bom_model, cost_mode, is_cost_template')
    .eq('id', workOrderId)
    .maybeSingle()
  if (error) throw error
  if (!order) return null

  const cost = await loadLatestSavedCost(supabase, workOrderId)
  return {
    work_order_id: String(order.id),
    order_no: String(order.order_no || ''),
    product_name: order.product_name ?? null,
    model: order.model ?? null,
    bom_model: order.bom_model ?? null,
    cost_mode: order.cost_mode ?? null,
    is_cost_template: Boolean(order.is_cost_template),
    has_saved_cost: Boolean(cost),
    total_cost: Number(cost?.total_cost || 0),
    updated_at: cost?.updated_at ? String(cost.updated_at) : null,
  }
}

/** テンプレート指令の枝番・原価明細を制作D指令へコピー */
export async function applyCostTemplateToWorkOrder(
  supabase: SupabaseClient,
  targetWorkOrderId: string,
  templateWorkOrderId: string
) {
  if (targetWorkOrderId === templateWorkOrderId) {
    throw new Error('テンプレートと保存先が同じです')
  }

  const [{ data: target, error: targetError }, { data: template, error: templateError }] =
    await Promise.all([
      supabase
        .from('work_orders')
        .select('id, order_no, product_name, model, bom_model, cost_mode')
        .eq('id', targetWorkOrderId)
        .maybeSingle(),
      supabase
        .from('work_orders')
        .select('id, order_no, product_name, model, bom_model, cost_mode')
        .eq('id', templateWorkOrderId)
        .maybeSingle(),
    ])
  if (targetError) throw targetError
  if (templateError) throw templateError
  if (!target) throw new Error('保存先D指令が見つかりません')
  if (!template) throw new Error('テンプレートD指令が見つかりません')

  const sourceOrderNo = String(template.order_no || '').trim()
  const targetOrderNo = String(target.order_no || '').trim()
  if (!sourceOrderNo || !targetOrderNo) {
    throw new Error('指令番号が不正です')
  }

  const templateCost = await loadLatestSavedCost(supabase, templateWorkOrderId)
  if (!templateCost) {
    throw new Error('テンプレート指令に保存済み原価がありません')
  }

  const { data: sourceBranches, error: branchError } = await supabase
    .from('work_order_branches')
    .select('*')
    .eq('work_order_id', templateWorkOrderId)
    .order('branch_no', { ascending: true })
  if (branchError) throw branchError

  const { data: sourceItems, error: itemError } = await supabase
    .from('work_order_cost_items')
    .select('*')
    .eq('work_order_cost_id', templateCost.id)
    .order('line_no', { ascending: true })
  if (itemError) throw itemError

  const now = new Date().toISOString()

  await supabase.from('work_order_branches').delete().eq('work_order_id', targetWorkOrderId)

  if (sourceBranches && sourceBranches.length > 0) {
    const branchPayload = sourceBranches.map((branch) => ({
      work_order_id: targetWorkOrderId,
      branch_no: branch.branch_no,
      part_key: branch.part_key,
      part_name: branch.part_name,
      product_code: branch.product_code,
      bom_quantity: branch.bom_quantity,
      unit_cost: branch.unit_cost,
      subtotal: branch.subtotal,
      notes: branch.notes,
      synced_at: now,
      created_at: now,
      updated_at: now,
    }))
    const { error: insertBranchError } = await supabase
      .from('work_order_branches')
      .insert(branchPayload)
    if (insertBranchError) throw insertBranchError
  }

  const { data: existingTargetCost } = await supabase
    .from('work_order_costs')
    .select('id')
    .eq('work_order_id', targetWorkOrderId)
    .maybeSingle()

  let targetCostId = existingTargetCost?.id as string | undefined
  const headerPayload = {
    order_no: targetOrderNo,
    work_order_id: targetWorkOrderId,
    total_material_cost: templateCost.total_material_cost,
    total_labor_cost: templateCost.total_labor_cost,
    total_indirect_cost: templateCost.total_indirect_cost,
    total_cost: templateCost.total_cost,
    cost_mode: templateCost.cost_mode || template.cost_mode || 'direct',
    branch_count: sourceBranches?.length || 0,
    last_bom_sync: now,
    updated_at: now,
  }

  if (targetCostId) {
    const { error: updateHeaderError } = await supabase
      .from('work_order_costs')
      .update(headerPayload)
      .eq('id', targetCostId)
    if (updateHeaderError) throw updateHeaderError
    await supabase.from('work_order_cost_items').delete().eq('work_order_cost_id', targetCostId)
  } else {
    const { data: inserted, error: insertHeaderError } = await supabase
      .from('work_order_costs')
      .insert({ ...headerPayload, created_at: now })
      .select('id')
      .maybeSingle()
    if (insertHeaderError) throw insertHeaderError
    targetCostId = inserted?.id
  }

  if (!targetCostId) throw new Error('保存先原価ヘッダの作成に失敗しました')

  if (sourceItems && sourceItems.length > 0) {
    const itemsPayload = sourceItems.map((item, index) => ({
      work_order_cost_id: targetCostId,
      line_no: index + 1,
      product_code: item.product_code,
      part_name: item.part_name,
      spec: item.spec,
      quantity: item.quantity,
      unit_price: item.unit_price,
      material_cost: item.material_cost,
      labor_cost: item.labor_cost,
      indirect_cost: item.indirect_cost,
      line_total: item.line_total,
      cost_type: item.cost_type,
      master_type: item.master_type || '指令原価',
      master_id: remapMasterId(item.master_id, sourceOrderNo, targetOrderNo),
    }))
    const { error: insertItemsError } = await supabase
      .from('work_order_cost_items')
      .insert(itemsPayload)
    if (insertItemsError) throw insertItemsError
  }

  const targetUpdate: Record<string, unknown> = {
    cost_template_work_order_id: templateWorkOrderId,
    updated_at: now,
  }
  if (template.cost_mode) targetUpdate.cost_mode = template.cost_mode
  if (template.bom_model && !target.bom_model) targetUpdate.bom_model = template.bom_model
  if (template.product_name && !target.product_name) {
    targetUpdate.product_name = template.product_name
  }

  const { error: updateTargetError } = await supabase
    .from('work_orders')
    .update(targetUpdate)
    .eq('id', targetWorkOrderId)
  if (updateTargetError) {
    if (!updateTargetError.message?.includes('cost_template_work_order_id')) {
      throw updateTargetError
    }
  }

  return {
    target_work_order_id: targetWorkOrderId,
    template_work_order_id: templateWorkOrderId,
    branch_count: sourceBranches?.length || 0,
    item_count: sourceItems?.length || 0,
    total_cost: Number(templateCost.total_cost || 0),
  }
}

/** 指定指令を製品の原価テンプレートとして登録 */
export async function setWorkOrderAsCostTemplate(
  supabase: SupabaseClient,
  workOrderId: string,
  enabled: boolean
) {
  const cost = await loadLatestSavedCost(supabase, workOrderId)
  if (enabled && !cost) {
    throw new Error('原価を確定保存してからテンプレート登録してください')
  }

  const { data, error } = await supabase
    .from('work_orders')
    .update({
      is_cost_template: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', workOrderId)
    .select('id, order_no, product_name, model, bom_model, is_cost_template')
    .maybeSingle()

  if (error) {
    if (error.message?.includes('is_cost_template')) {
      throw new Error(
        'is_cost_template 列がありません。Supabaseで migrate-add-work-order-cost-template.sql を実行してください。'
      )
    }
    throw error
  }
  return data
}
