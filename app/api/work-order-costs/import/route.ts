import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const buildLineOrderNo = (masterId: string) => {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `LINE-${masterId}-${timestamp}`
}

type ImportRow = {
  line_no: number
  order_no: string
  branch_no: string
  display_name: string
  product_code: string
  part_name: string
  spec: string
  quantity: number
  unit_price: number
  material_cost: number
  labor_cost: number
  indirect_cost: number
  line_total: number
  is_manual: boolean
  cost_type: string
  master_type: string
  master_id: string
}

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'true' || text === '1' || text === 'yes'
}

const normalizeKey = (key: string): string => key.trim().toLowerCase().replace(/[\s_]/g, '')

// master_id / part_key 用の比較正規化（目視しづらい差を吸収）
const normalizeMasterId = (value: string): string =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[‐‑‒–—―ー−－﹣]/g, '-')
    .toLowerCase()

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  const entries = Object.entries(row)
  for (const key of keys) {
    const found = entries.find(([k]) => normalizeKey(k) === normalizeKey(key))
    if (found) return found[1]
  }
  return undefined
}

const mapRow = (row: Record<string, unknown>, index: number): ImportRow | null => {
  const masterIdRaw = pick(row, ['master_id', 'masterid', 'master id', 'master-id'])
  const orderNo = String(pick(row, ['order_no', 'orderno', '指令番号']) ?? '').trim()
  const branchNo = String(pick(row, ['branch_no', 'branchno', '枝番']) ?? '').trim()
  const masterType = String(pick(row, ['master_type', 'mastertype']) ?? 'ライン原価').trim() || 'ライン原価'

  // 枝番を 2 桁ゼロパディング化（1 → 01, B01 → 01）
  const formatBranchNo = (no: string): string => {
    const stripped = no.replace(/^[A-Za-z]+/, '').replace(/^0+/, '')
    if (!stripped) return no
    return String(parseInt(stripped)).padStart(2, '0')
  }

  // D指令原価インポートは order_no + branch_no (2桁化) を優先キーにする
  const derivedMasterId = orderNo && branchNo ? `${orderNo}-${formatBranchNo(branchNo)}` : ''
  const rawMasterId = String(masterIdRaw ?? '').trim()
  const masterId = masterType === '指令原価'
    ? (derivedMasterId || rawMasterId)
    : (rawMasterId || derivedMasterId)
  if (!masterId) return null

  const materialCost = toNumber(pick(row, ['material_cost', 'materialc', '材料費']))
  const laborCost = toNumber(pick(row, ['labor_cost', 'laborc', '労務費']))
  const indirectCost = toNumber(pick(row, ['indirect_cost', 'indirectc', '間接費']))

  const lineTotalRaw = pick(row, ['line_total', 'linetotal', 'total', '合計'])
  const lineTotal = lineTotalRaw === undefined || lineTotalRaw === ''
    ? materialCost + laborCost + indirectCost
    : toNumber(lineTotalRaw)

  return {
    line_no: Math.max(1, Math.trunc(toNumber(pick(row, ['line_no', 'lineno', 'work_order_line_no'])) || index + 1)),
    order_no: orderNo,
    branch_no: branchNo,
    display_name: String(pick(row, ['display_name', 'displayname', '表示名']) ?? '').trim(),
    product_code: String(pick(row, ['product_code', 'productcode', 'コード', '商品コード']) ?? '').trim(),
    part_name: String(pick(row, ['part_name', 'partname', '部品名']) ?? '').trim(),
    spec: String(pick(row, ['spec', '規格']) ?? '').trim(),
    quantity: toNumber(pick(row, ['quantity', '数量'])),
    unit_price: toNumber(pick(row, ['unit_price', 'unitprice', '単価'])),
    material_cost: materialCost,
    labor_cost: laborCost,
    indirect_cost: indirectCost,
    line_total: lineTotal,
    is_manual: toBoolean(pick(row, ['is_manual', 'ismanual'])),
    cost_type: String(pick(row, ['cost_type', 'costtype', '原価区分']) ?? 'ベース').trim() || 'ベース',
    master_type: masterType,
    master_id: masterId,
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const workbook = XLSX.read(bytes, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return NextResponse.json({ error: 'empty file' }, { status: 400 })
    }

    const mappedRows = rawRows
      .map((row, index) => mapRow(row, index))
      .filter((row): row is ImportRow => row !== null)

    if (mappedRows.length === 0) {
      return NextResponse.json({ error: 'master_id が1件も見つかりませんでした' }, { status: 400 })
    }

    // part_key と master_id の照合は大文字小文字を無視して行い、DB上の実キーへ寄せる
    const { data: partKeys, error: partKeysError } = await supabase
      .from('heater_parts_master')
      .select('part_key')

    if (partKeysError) {
      console.error('part key fetch error:', partKeysError)
      return NextResponse.json({ error: `part key fetch failed: ${partKeysError.message}` }, { status: 500 })
    }

    const partKeyMap = new Map<string, string>()
    const normalizedPartKeyMap = new Map<string, string>()
    const allPartKeys: string[] = []
    for (const part of partKeys || []) {
      const key = String(part.part_key || '').trim()
      if (!key) continue
      allPartKeys.push(key)
      const lower = key.toLowerCase()
      if (!partKeyMap.has(lower)) {
        partKeyMap.set(lower, key)
      }
      const normalized = normalizeMasterId(key)
      if (!normalizedPartKeyMap.has(normalized)) {
        normalizedPartKeyMap.set(normalized, key)
      }
    }

    const normalizedRows = mappedRows.map((row) => {
      const normalizedMasterId =
        partKeyMap.get(row.master_id.toLowerCase()) ||
        normalizedPartKeyMap.get(normalizeMasterId(row.master_id)) ||
        row.master_id
      return {
        ...row,
        master_id: normalizedMasterId,
      }
    })

    const grouped = new Map<string, ImportRow[]>()
    for (const row of normalizedRows) {
      const groupKey = row.master_type === '指令原価'
        ? `ORDER:${row.order_no || row.master_id}`
        : `LINE:${row.master_id}`
      const list = grouped.get(groupKey) ?? []
      list.push(row)
      grouped.set(groupKey, list)
    }

    let updatedMasterCount = 0
    let insertedMasterCount = 0
    let importedRowCount = 0
    let branchUpsertedCount = 0
    const importedSummaryByMaster = new Map<string, { material: number; indirect: number; total: number }>()
    for (const row of normalizedRows) {
      if (row.master_type !== 'ライン原価') continue
      const prev = importedSummaryByMaster.get(row.master_id) || { material: 0, indirect: 0, total: 0 }
      importedSummaryByMaster.set(row.master_id, {
        material: prev.material + Number(row.material_cost || 0),
        indirect: prev.indirect + Number(row.indirect_cost || 0),
        total: prev.total + Number(row.line_total || 0),
      })
    }

    for (const [, rows] of grouped.entries()) {
      const isOrderCostGroup = rows.some((row) => row.master_type === '指令原価')
      const representativeMasterId = String(rows[0]?.master_id || '')
      const representativeOrderNo = String(rows[0]?.order_no || '').trim()
      const totalMaterialCost = rows.reduce((sum, row) => sum + Number(row.material_cost || 0), 0)
      const totalLaborCost = rows.reduce((sum, row) => sum + Number(row.labor_cost || 0), 0)
      const totalIndirectCost = rows.reduce((sum, row) => sum + Number(row.indirect_cost || 0), 0)
      const totalCost = rows.reduce((sum, row) => sum + Number(row.line_total || 0), 0)

      let workOrderCostId = ''
      let targetWorkOrderId: string | null = null

      if (isOrderCostGroup && representativeOrderNo) {
        const { data: workOrders, error: workOrderError } = await supabase
          .from('work_orders')
          .select('id')
          .eq('order_no', representativeOrderNo)
          .order('created_at', { ascending: false })
          .limit(1)

        if (workOrderError) {
          console.error('work order lookup error:', workOrderError)
          return NextResponse.json({ error: `work order lookup failed: ${workOrderError.message}` }, { status: 500 })
        }

        targetWorkOrderId = workOrders && workOrders.length > 0 ? String(workOrders[0].id) : null

        if (targetWorkOrderId) {
          // D指令原価インポート時は枝番マスタも同期して、画面の枝番選択に反映する
          const now = new Date().toISOString()
          const branchMap = new Map<string, { masterId: string; partName: string; subtotal: number }>()
          for (const row of rows) {
            const branchNo = String(row.branch_no || '').trim()
            if (!branchNo) continue
            const masterId = String(row.master_id || `${representativeOrderNo}-${branchNo}`).trim()
            const preferredBranchName = String(row.display_name || row.part_name || '').trim()
            const prev = branchMap.get(branchNo)
            if (prev) {
              prev.subtotal += Number(row.line_total || 0)
              if (!prev.partName && preferredBranchName) prev.partName = preferredBranchName
            } else {
              branchMap.set(branchNo, {
                masterId,
                partName: preferredBranchName,
                subtotal: Number(row.line_total || 0),
              })
            }
          }

          const branchRows = Array.from(branchMap.entries()).map(([branchNo, info]) => ({
            work_order_id: targetWorkOrderId,
            branch_no: branchNo,
            part_key: info.masterId,
            part_name: info.partName || null,
            product_code: null,
            bom_quantity: 1,
            unit_cost: Math.round(info.subtotal),
            subtotal: Math.round(info.subtotal),
            notes: 'imported from work_order_cost_items',
            synced_at: now,
            updated_at: now,
          }))

          if (branchRows.length > 0) {
            const { data: upsertedBranches, error: branchUpsertError } = await supabase
              .from('work_order_branches')
              .upsert(branchRows, { onConflict: 'work_order_id,branch_no' })
              .select('id')

            if (branchUpsertError) {
              console.error('branch upsert error:', branchUpsertError)
              return NextResponse.json({ error: `branch upsert failed: ${branchUpsertError.message}` }, { status: 500 })
            }

            branchUpsertedCount += (upsertedBranches || []).length
          }

          // BOM運用のD指令として扱えるようにモードを更新（未マイグレーション環境は失敗を無視）
          const { error: woUpdateError } = await supabase
            .from('work_orders')
            .update({ cost_mode: 'bom', bom_model: representativeOrderNo, updated_at: now })
            .eq('id', targetWorkOrderId)

          const woUpdateMsg = String(woUpdateError?.message || '')
          if (woUpdateError && !woUpdateMsg.includes("Could not find the 'cost_mode' column") && !woUpdateMsg.includes("Could not find the 'bom_model' column")) {
            console.error('work_orders mode update error:', woUpdateError)
          }
        }
      }

      if (isOrderCostGroup) {
        let existingHeader: { id: string } | null = null
        if (targetWorkOrderId) {
          const { data, error } = await supabase
            .from('work_order_costs')
            .select('id')
            .eq('work_order_id', targetWorkOrderId)
            .limit(1)
            .maybeSingle()
          if (error) {
            console.error('existing header check error:', error)
            return NextResponse.json({ error: `existing header check failed: ${error.message}` }, { status: 500 })
          }
          existingHeader = data ? { id: String(data.id) } : null
        } else if (representativeOrderNo) {
          const { data, error } = await supabase
            .from('work_order_costs')
            .select('id')
            .eq('order_no', representativeOrderNo)
            .limit(1)
            .maybeSingle()
          if (error) {
            console.error('existing header check by order_no error:', error)
            return NextResponse.json({ error: `existing header check failed: ${error.message}` }, { status: 500 })
          }
          existingHeader = data ? { id: String(data.id) } : null
        }

        if (existingHeader?.id) {
          workOrderCostId = existingHeader.id
          const { error: deleteError } = await supabase
            .from('work_order_cost_items')
            .delete()
            .eq('work_order_cost_id', workOrderCostId)

          if (deleteError) {
            console.error('delete order items error:', deleteError)
            return NextResponse.json({ error: `delete failed: ${deleteError.message}` }, { status: 500 })
          }

          const { error: headerUpdateError } = await supabase
            .from('work_order_costs')
            .update({
              order_no: representativeOrderNo || null,
              work_order_id: targetWorkOrderId,
              total_material_cost: totalMaterialCost,
              total_labor_cost: totalLaborCost,
              total_indirect_cost: totalIndirectCost,
              total_cost: totalCost,
            })
            .eq('id', workOrderCostId)

          if (headerUpdateError) {
            console.error('order header update error:', headerUpdateError)
            return NextResponse.json({ error: `header update failed: ${headerUpdateError.message}` }, { status: 500 })
          }

          updatedMasterCount += 1
        } else {
          const { data: createdHeader, error: headerInsertError } = await supabase
            .from('work_order_costs')
            .insert([
              {
                order_no: representativeOrderNo || buildLineOrderNo(representativeMasterId || 'ORDER-IMPORT'),
                work_order_id: targetWorkOrderId,
                total_material_cost: totalMaterialCost,
                total_labor_cost: totalLaborCost,
                total_indirect_cost: totalIndirectCost,
                total_cost: totalCost,
                notes: `imported by order_no=${representativeOrderNo || 'unknown'}`,
              },
            ])
            .select('id')
            .single()

          if (headerInsertError || !createdHeader?.id) {
            console.error('order header insert error:', headerInsertError)
            return NextResponse.json({ error: `header insert failed: ${headerInsertError?.message || 'unknown'}` }, { status: 500 })
          }

          workOrderCostId = String(createdHeader.id)
          insertedMasterCount += 1
        }
      } else {
        const { data: existingRows, error: existingError } = await supabase
          .from('work_order_cost_items')
          .select('id, work_order_cost_id')
          .eq('master_id', representativeMasterId)
          .limit(1)

        if (existingError) {
          console.error('existing check error:', existingError)
          return NextResponse.json({ error: `existing check failed: ${existingError.message}` }, { status: 500 })
        }

        if (existingRows && existingRows.length > 0) {
          workOrderCostId = String(existingRows[0].work_order_cost_id || '')

          const { error: deleteError } = await supabase
            .from('work_order_cost_items')
            .delete()
            .eq('master_id', representativeMasterId)

          if (deleteError) {
            console.error('delete by master_id error:', deleteError)
            return NextResponse.json({ error: `delete failed: ${deleteError.message}` }, { status: 500 })
          }

          if (workOrderCostId) {
            const { error: headerUpdateError } = await supabase
              .from('work_order_costs')
              .update({
                total_material_cost: totalMaterialCost,
                total_labor_cost: totalLaborCost,
                total_indirect_cost: totalIndirectCost,
                total_cost: totalCost,
              })
              .eq('id', workOrderCostId)

            if (headerUpdateError) {
              console.error('header update error:', headerUpdateError)
              return NextResponse.json({ error: `header update failed: ${headerUpdateError.message}` }, { status: 500 })
            }
          }

          updatedMasterCount += 1
        } else {
          const { data: createdHeader, error: headerInsertError } = await supabase
            .from('work_order_costs')
            .insert([
              {
                order_no: buildLineOrderNo(representativeMasterId),
                work_order_id: null,
                total_material_cost: totalMaterialCost,
                total_labor_cost: totalLaborCost,
                total_indirect_cost: totalIndirectCost,
                total_cost: totalCost,
                notes: `imported by master_id=${representativeMasterId}`,
              },
            ])
            .select('id')
            .single()

          if (headerInsertError || !createdHeader?.id) {
            console.error('header insert error:', headerInsertError)
            return NextResponse.json({ error: `header insert failed: ${headerInsertError?.message || 'unknown'}` }, { status: 500 })
          }

          workOrderCostId = String(createdHeader.id)
          insertedMasterCount += 1
        }
      }

      if (!workOrderCostId) {
        return NextResponse.json({ error: `work_order_cost_id not found for master_id=${representativeMasterId}` }, { status: 500 })
      }

      const rowsToInsert = rows.map((row) => ({
        work_order_cost_id: workOrderCostId,
        line_no: row.line_no,
        product_code: row.product_code,
        part_name: row.part_name,
        spec: row.spec,
        quantity: row.quantity,
        unit_price: row.unit_price,
        material_cost: row.material_cost,
        labor_cost: row.labor_cost,
        indirect_cost: row.indirect_cost,
        line_total: row.line_total,
        cost_type: row.cost_type,
        master_type: row.master_type,
        master_id: row.master_id,
      }))

      const { error: insertError } = await supabase
        .from('work_order_cost_items')
        .insert(rowsToInsert)

      if (insertError) {
        console.error('insert rows error:', insertError)
        return NextResponse.json({ error: `insert failed: ${insertError.message}` }, { status: 500 })
      }

      importedRowCount += rows.length
    }

    let partsUpdatedCount = 0
    const unmatchedMasterIds: string[] = []
    const unmatchedDetails: Array<{ master_id: string; reason: string; near_part_keys: string[] }> = []

    for (const [masterId, totals] of importedSummaryByMaster.entries()) {
      const { data: updatedRows, error: partsUpdateError } = await supabase
        .from('heater_parts_master')
        .update({
          material_cost_total: totals.material,
          indirect_cost_total: totals.indirect,
          cost_price: totals.material + totals.indirect,
        })
        .eq('part_key', masterId)
        .select('part_key')

      if (partsUpdateError) {
        console.error('heater_parts_master update error:', { masterId, error: partsUpdateError })
        continue
      }

      if (updatedRows && updatedRows.length > 0) {
        partsUpdatedCount += updatedRows.length
      } else {
        unmatchedMasterIds.push(masterId)
        const normalizedMaster = normalizeMasterId(masterId)
        const nearPartKeys = allPartKeys
          .filter((k) => normalizeMasterId(k).slice(0, 8) === normalizedMaster.slice(0, 8))
          .slice(0, 5)

        unmatchedDetails.push({
          master_id: masterId,
          reason: nearPartKeys.length > 0 ? 'part_keyが存在しない（近似キーあり）' : 'part_keyが存在しない',
          near_part_keys: nearPartKeys,
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: 'L指令原価明細をインポートしました',
      summary: {
        totalRows: normalizedRows.length,
        importedRows: importedRowCount,
        updatedMasters: updatedMasterCount,
        insertedMasters: insertedMasterCount,
        branchUpserted: branchUpsertedCount,
        partsUpdated: partsUpdatedCount,
        unmatchedMasterIds,
        unmatchedDetails,
      },
    })
  } catch (error) {
    console.error('work-order-cost-items import error:', error)
    return NextResponse.json({ error: 'import failed' }, { status: 500 })
  }
}
