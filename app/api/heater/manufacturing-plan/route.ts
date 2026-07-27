import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import {
  inferProductCategory,
  isHeaterProductCategory,
  normalizeProductCategory,
  type ProductCategory,
} from '@/lib/product-category'
import { aggregateWorkOrderSavedCost } from '@/lib/work-order-bom-cost-aggregate'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

interface ManufacturingPlan {
  model: string
  quantity: number
  productCategory?: ProductCategory | string | null
  modelName?: string | null
}

interface AggregatedItem {
  product_code: string | null
  part_key: string
  part_name: string
  spec: string | null
  cost_price: number
  total_qty: number
  total_cost: number
  stock_qty: number
  shortage_qty: number
  source?: 'heater_bom' | 'd_order'
}

type CostSource = 'heater_bom' | 'd_order'

type WorkOrderMatch = {
  id: string
  order_no: string
  product_name: string | null
  model: string | null
  bom_model: string | null
  qty: number | null
}

async function fetchAllBomRows(supabase: SupabaseClient) {
  let allBomData: any[] = []
  let from = 0
  const pageSize = 1000
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('heater_bom')
      .select('*')
      .range(from, from + pageSize - 1)

    if (error) throw error

    if (data && data.length > 0) {
      allBomData = [...allBomData, ...data]
      from += pageSize
      hasMore = data.length === pageSize
    } else {
      hasMore = false
    }
  }

  return allBomData
}

async function resolvePlanCategories(
  supabase: SupabaseClient,
  plans: ManufacturingPlan[]
): Promise<Array<ManufacturingPlan & { productCategory: ProductCategory }>> {
  const modelsNeedingLookup = plans
    .filter((p) => p.quantity > 0 && !p.productCategory)
    .map((p) => p.model)

  const categoryByModel = new Map<string, ProductCategory>()
  if (modelsNeedingLookup.length > 0) {
    const { data } = await supabase
      .from('heater_models')
      .select('model, name, product_category')
      .in('model', modelsNeedingLookup)
    for (const row of (data || []) as Array<{
      model: string
      name?: string | null
      product_category?: string | null
    }>) {
      categoryByModel.set(
        String(row.model),
        normalizeProductCategory(
          row.product_category || inferProductCategory(String(row.model), row.name)
        )
      )
    }
  }

  return plans.map((plan) => ({
    ...plan,
    productCategory: normalizeProductCategory(
      plan.productCategory ||
        categoryByModel.get(plan.model) ||
        inferProductCategory(plan.model, plan.modelName)
    ),
  }))
}

async function findWorkOrderForModel(
  supabase: SupabaseClient,
  model: string
): Promise<WorkOrderMatch | null> {
  const normalized = String(model || '').trim()
  if (!normalized) return null

  const columns = ['order_no', 'model', 'bom_model'] as const
  for (const column of columns) {
    const { data, error } = await supabase
      .from('work_orders')
      .select('id, order_no, product_name, model, bom_model, qty')
      .eq(column, normalized)
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) throw error
    const rows = (data || []) as WorkOrderMatch[]
    if (rows.length === 0) continue

    const preferred =
      rows.find((row) => String(row.model || '').trim() === normalized) ||
      rows.find((row) => String(row.bom_model || '').trim() === normalized) ||
      rows.find((row) => String(row.order_no || '').trim() === normalized) ||
      rows[0]
    return preferred
  }

  return null
}

function buildHeaterManufacturing(
  plans: Array<ManufacturingPlan & { productCategory: ProductCategory }>,
  bomData: any[],
  partsMap: Map<
    string,
    {
      product_code: string | null
      part_name: string
      spec: string | null
      cost_price: number
    }
  >,
  stocksMap: Map<string, number>
) {
  const manufacturingData = plans.map((plan) => {
    const bomItems = (bomData || [])
      .filter((item) => item.model === plan.model)
      .map((item) => {
        const partInfo = partsMap.get(item.part_key) || {
          product_code: null,
          part_name: 'Unknown',
          spec: null,
          cost_price: 0,
        }
        const costPrice = partInfo.cost_price || 0
        const subtotal = costPrice * item.quantity * plan.quantity
        return {
          model: plan.model,
          part_key: item.part_key,
          part_name: partInfo.part_name,
          spec: partInfo.spec,
          product_code: partInfo.product_code,
          quantity: item.quantity,
          cost_price: costPrice,
          subtotal,
        }
      })

    return {
      model: plan.model,
      quantity: plan.quantity,
      product_category: plan.productCategory,
      cost_source: 'heater_bom' as CostSource,
      bomItems,
      totalCost: bomItems.reduce((sum, item) => sum + item.subtotal, 0),
      order_no: null as string | null,
      work_order_id: null as string | null,
      has_saved_cost: null as boolean | null,
      material_total: null as number | null,
      labor_total: null as number | null,
      indirect_total: null as number | null,
      unit_total_cost: null as number | null,
      warning: null as string | null,
    }
  })

  const aggregatedMap = new Map<string, AggregatedItem>()
  for (const plan of plans) {
    const bomItems = (bomData || []).filter((item) => item.model === plan.model)
    for (const item of bomItems) {
      const partInfo = partsMap.get(item.part_key) || {
        product_code: null,
        part_name: 'Unknown',
        spec: null,
        cost_price: 0,
      }
      const costPrice = partInfo.cost_price || 0
      const key = `heater:${partInfo.product_code || item.part_key}`
      if (aggregatedMap.has(key)) {
        const existing = aggregatedMap.get(key)!
        existing.total_qty += item.quantity * plan.quantity
        existing.total_cost += costPrice * item.quantity * plan.quantity
      } else {
        const stockQty = partInfo.product_code
          ? stocksMap.get(partInfo.product_code) || 0
          : 0
        const totalQty = item.quantity * plan.quantity
        aggregatedMap.set(key, {
          product_code: partInfo.product_code,
          part_key: item.part_key,
          part_name: partInfo.part_name,
          spec: partInfo.spec,
          cost_price: costPrice,
          total_qty: totalQty,
          total_cost: costPrice * totalQty,
          stock_qty: stockQty,
          shortage_qty: Math.max(0, totalQty - stockQty),
          source: 'heater_bom',
        })
      }
    }
  }

  aggregatedMap.forEach((item) => {
    item.shortage_qty = Math.max(0, item.total_qty - (item.stock_qty || 0))
  })

  return {
    manufacturingData,
    aggregatedItems: Array.from(aggregatedMap.values()),
  }
}

async function buildInstructionManufacturing(
  supabase: SupabaseClient,
  plans: Array<ManufacturingPlan & { productCategory: ProductCategory }>,
  stocksMap: Map<string, number>
) {
  const manufacturingData = []
  const aggregatedMap = new Map<string, AggregatedItem>()
  const warnings: string[] = []

  for (const plan of plans) {
    const wo = await findWorkOrderForModel(supabase, plan.model)
    if (!wo) {
      const warning = `${plan.model}: 対応するD指令が見つかりません（order_no / model / bom_model）`
      warnings.push(warning)
      manufacturingData.push({
        model: plan.model,
        quantity: plan.quantity,
        product_category: plan.productCategory,
        cost_source: 'd_order' as CostSource,
        bomItems: [],
        totalCost: 0,
        order_no: null,
        work_order_id: null,
        has_saved_cost: false,
        material_total: 0,
        labor_total: 0,
        indirect_total: 0,
        unit_total_cost: 0,
        warning,
      })
      continue
    }

    const { data: branches, error: brErr } = await supabase
      .from('work_order_branches')
      .select('*')
      .eq('work_order_id', wo.id)
      .order('branch_no', { ascending: true })
    if (brErr) throw brErr

    const saved = await aggregateWorkOrderSavedCost(supabase, wo, branches || [])
    if (!saved.has_saved_cost) {
      const warning = `${plan.model}: D指令 ${wo.order_no} の原価が未保存です（D指令原価計算で保存してください）`
      warnings.push(warning)
    }

    const qty = plan.quantity
    const unitTotal = saved.grand_total
    const bomItems = saved.branches.flatMap((branch) =>
      (branch.cost_items || []).map((item) => {
        const unitLine = Number(item.line_total || 0)
        return {
          model: plan.model,
          part_key: item.product_code || item.master_id || branch.part_key,
          part_name: item.part_name || branch.part_name || 'D指令原価明細',
          spec: item.spec || null,
          product_code: item.product_code || null,
          quantity: Number(item.quantity || 0),
          cost_price: Number(item.unit_price || 0),
          subtotal: unitLine * qty,
          material_cost: Number(item.material_cost || 0) * qty,
          labor_cost: Number(item.labor_cost || 0) * qty,
          indirect_cost: Number(item.indirect_cost || 0) * qty,
          branch_no: branch.branch_no,
        }
      })
    )

    // 明細が無くてもヘッダ合計があれば仮想行を1つ出す
    if (bomItems.length === 0 && saved.has_saved_cost && unitTotal > 0) {
      bomItems.push({
        model: plan.model,
        part_key: wo.order_no,
        part_name: `D指令原価（${wo.order_no}）`,
        spec: '材料+工賃+間接',
        product_code: null,
        quantity: 1,
        cost_price: unitTotal,
        subtotal: unitTotal * qty,
        material_cost: saved.material_total * qty,
        labor_cost: saved.labor_total * qty,
        indirect_cost: saved.indirect_total * qty,
        branch_no: '指令全体',
      })
    }

    manufacturingData.push({
      model: plan.model,
      quantity: qty,
      product_category: plan.productCategory,
      cost_source: 'd_order' as CostSource,
      bomItems,
      totalCost: unitTotal * qty,
      order_no: wo.order_no,
      work_order_id: wo.id,
      has_saved_cost: saved.has_saved_cost,
      material_total: saved.material_total * qty,
      labor_total: saved.labor_total * qty,
      indirect_total: saved.indirect_total * qty,
      unit_total_cost: unitTotal,
      warning: saved.has_saved_cost
        ? null
        : `${plan.model}: D指令 ${wo.order_no} の原価が未保存です`,
    })

    for (const item of bomItems) {
      const key = `d:${wo.order_no}:${item.product_code || item.part_key}:${item.part_name}`
      const stockQty = item.product_code ? stocksMap.get(item.product_code) || 0 : 0
      const lineQty = Number(item.quantity || 0) * qty
      if (aggregatedMap.has(key)) {
        const existing = aggregatedMap.get(key)!
        existing.total_qty += lineQty
        existing.total_cost += item.subtotal
      } else {
        aggregatedMap.set(key, {
          product_code: item.product_code,
          part_key: item.part_key,
          part_name: `[D:${wo.order_no}] ${item.part_name}`,
          spec: item.spec,
          cost_price: item.cost_price,
          total_qty: lineQty,
          total_cost: item.subtotal,
          stock_qty: stockQty,
          shortage_qty: Math.max(0, lineQty - stockQty),
          source: 'd_order',
        })
      }
    }
  }

  aggregatedMap.forEach((item) => {
    item.shortage_qty = Math.max(0, item.total_qty - (item.stock_qty || 0))
  })

  return {
    manufacturingData,
    aggregatedItems: Array.from(aggregatedMap.values()),
    warnings,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { plans } = await req.json()
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceRoleKey || supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    )

    const typedPlans = ((plans || []) as ManufacturingPlan[]).filter(
      (plan) => Number(plan.quantity) > 0
    )
    if (typedPlans.length === 0) {
      return NextResponse.json({
        manufacturingData: [],
        aggregatedItems: [],
        instructionSummaries: [],
        warnings: [],
      })
    }

    const resolvedPlans = await resolvePlanCategories(supabase, typedPlans)
    const heaterPlans = resolvedPlans.filter((p) => isHeaterProductCategory(p.productCategory))
    const instructionPlans = resolvedPlans.filter(
      (p) => !isHeaterProductCategory(p.productCategory)
    )

    const { data: partsData } = await supabase
      .from('heater_parts_master')
      .select('part_key, product_code, part_name, spec, cost_price')

    const { data: stocksData } = await supabase
      .from('stocks')
      .select('product_code, stock_qty')

    const stocksMap = new Map(
      (stocksData || []).map((stock) => [stock.product_code, stock.stock_qty || 0])
    )
    const partsMap = new Map(
      (partsData || []).map((part) => [
        part.part_key,
        {
          product_code: part.product_code,
          part_name: part.part_name,
          spec: part.spec,
          cost_price: part.cost_price || 0,
        },
      ])
    )

    let manufacturingData: any[] = []
    let aggregatedItems: AggregatedItem[] = []
    const warnings: string[] = []

    if (heaterPlans.length > 0) {
      const bomData = await fetchAllBomRows(supabase)
      const heaterResult = buildHeaterManufacturing(
        heaterPlans,
        bomData,
        partsMap,
        stocksMap
      )
      manufacturingData = manufacturingData.concat(heaterResult.manufacturingData)
      aggregatedItems = aggregatedItems.concat(heaterResult.aggregatedItems)
    }

    if (instructionPlans.length > 0) {
      const instructionResult = await buildInstructionManufacturing(
        supabase,
        instructionPlans,
        stocksMap
      )
      manufacturingData = manufacturingData.concat(instructionResult.manufacturingData)
      aggregatedItems = aggregatedItems.concat(instructionResult.aggregatedItems)
      warnings.push(...instructionResult.warnings)
    }

    aggregatedItems.sort((a, b) => b.total_cost - a.total_cost)

    const instructionSummaries = manufacturingData
      .filter((row) => row.cost_source === 'd_order')
      .map((row) => ({
        model: row.model,
        quantity: row.quantity,
        product_category: row.product_category,
        order_no: row.order_no,
        work_order_id: row.work_order_id,
        has_saved_cost: row.has_saved_cost,
        unit_total_cost: row.unit_total_cost,
        material_total: row.material_total,
        labor_total: row.labor_total,
        indirect_total: row.indirect_total,
        total_cost: row.totalCost,
        warning: row.warning,
      }))

    return NextResponse.json({
      manufacturingData,
      aggregatedItems,
      instructionSummaries,
      warnings,
    })
  } catch (err: any) {
    console.error('POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
