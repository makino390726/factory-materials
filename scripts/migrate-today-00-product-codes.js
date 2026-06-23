/**
 * 指定日（デフォルト: 本日 JST）に取り込まれた 00 付き商品コードを正規コードへ振替
 *
 * 診断: node --env-file=.env.local scripts/migrate-today-00-product-codes.js
 * 実行: node --env-file=.env.local scripts/migrate-today-00-product-codes.js --apply
 * 日付: node --env-file=.env.local scripts/migrate-today-00-product-codes.js --date=2026-06-02 --apply
 */
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const apply = process.argv.includes('--apply')
const dateArg = process.argv.find((a) => a.startsWith('--date='))?.split('=')[1]

if (!supabaseUrl || !supabaseKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const PRODUCT_CODE_TABLES = [
  'stock_movements',
  'unmatched_parts',
  'work_order_cost_items',
  'heater_parts_master',
  'work_order_branches',
]

function resolveTargetDate() {
  if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg)) return dateArg
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

function jstDayRange(dateStr) {
  return {
    start: `${dateStr}T00:00:00+09:00`,
    end: `${dateStr}T23:59:59.999+09:00`,
  }
}

function isZeroPrefixNumericCode(code) {
  const trimmed = String(code || '').trim()
  return /^\d+$/.test(trimmed) && trimmed.startsWith('00') && trimmed.length > 2
}

function toTargetCode(sourceCode) {
  return String(sourceCode).trim().slice(2)
}

async function fetchMovementsInRange(range) {
  const pageSize = 1000
  let from = 0
  let all = []
  while (true) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('product_code, created_at, input_method, movement')
      .gte('created_at', range.start)
      .lte('created_at', range.end)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

async function fetchProductsInRange(range) {
  const pageSize = 1000
  let from = 0
  let all = []
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, name, barcode, created_at')
      .gte('created_at', range.start)
      .lte('created_at', range.end)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

async function fetchAllProductCodes() {
  const pageSize = 1000
  let from = 0
  const codes = new Set()
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('product_code')
      .order('product_code', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) codes.add(String(row.product_code).trim())
    if (data.length < pageSize) break
    from += pageSize
  }
  return codes
}

async function updateProductCodeInTable(table, sourceCode, targetCode) {
  const { error } = await supabase
    .from(table)
    .update({ product_code: targetCode })
    .eq('product_code', sourceCode)

  if (error) {
    if (String(error.message || '').includes('Could not find the table')) return
    throw new Error(`${table}: ${error.message}`)
  }
}

async function mergeIntoExisting(sourceCode, targetCode) {
  const { error: movementErr } = await supabase
    .from('stock_movements')
    .update({ product_code: targetCode })
    .eq('product_code', sourceCode)
  if (movementErr) throw new Error(`stock_movements: ${movementErr.message}`)

  const { data: sourceStock } = await supabase
    .from('stocks')
    .select('stock_qty, unit_price, total_amount, shelf_no')
    .eq('product_code', sourceCode)
    .maybeSingle()

  if (sourceStock) {
    const { data: targetStock } = await supabase
      .from('stocks')
      .select('stock_qty, unit_price, total_amount, shelf_no')
      .eq('product_code', targetCode)
      .maybeSingle()

    const upsertPayload = {
      product_code: targetCode,
      stock_qty: (targetStock?.stock_qty || 0) + (sourceStock.stock_qty || 0),
      updated_at: new Date().toISOString(),
    }
    if (sourceStock.unit_price != null && targetStock?.unit_price == null) {
      upsertPayload.unit_price = sourceStock.unit_price
    }
    if (sourceStock.total_amount != null && targetStock?.total_amount == null) {
      upsertPayload.total_amount = sourceStock.total_amount
    }
    if (sourceStock.shelf_no && !targetStock?.shelf_no) {
      upsertPayload.shelf_no = sourceStock.shelf_no
    }

    const { error: stockErr } = await supabase
      .from('stocks')
      .upsert(upsertPayload, { onConflict: 'product_code' })
    if (stockErr) throw new Error(`stocks merge: ${stockErr.message}`)

    await supabase.from('stocks').delete().eq('product_code', sourceCode)
  }

  for (const table of PRODUCT_CODE_TABLES) {
    await updateProductCodeInTable(table, sourceCode, targetCode)
  }

  const { error: deleteErr } = await supabase.from('products').delete().eq('product_code', sourceCode)
  if (deleteErr) throw new Error(`products delete: ${deleteErr.message}`)
}

async function renameProduct(sourceCode, targetCode) {
  const { data: sourceProduct, error: fetchErr } = await supabase
    .from('products')
    .select('*')
    .eq('product_code', sourceCode)
    .maybeSingle()

  if (fetchErr) throw new Error(`products fetch: ${fetchErr.message}`)
  if (!sourceProduct) return

  const nextBarcode =
    sourceProduct.barcode && String(sourceProduct.barcode).includes(sourceCode)
      ? String(sourceProduct.barcode).replace(sourceCode, targetCode)
      : sourceProduct.barcode

  const { error: insertErr } = await supabase.from('products').insert({
    product_code: targetCode,
    name: sourceProduct.name,
    shelf_no: sourceProduct.shelf_no,
    unit: sourceProduct.unit,
    barcode: nextBarcode,
    qr_code_data: sourceProduct.qr_code_data,
    purchase_price: sourceProduct.purchase_price,
    cost_price: sourceProduct.cost_price,
  })
  if (insertErr) throw new Error(`products insert: ${insertErr.message}`)

  for (const table of PRODUCT_CODE_TABLES) {
    await updateProductCodeInTable(table, sourceCode, targetCode)
  }

  const { data: sourceStock } = await supabase
    .from('stocks')
    .select('product_code')
    .eq('product_code', sourceCode)
    .maybeSingle()

  if (sourceStock) {
    const { error: stockRenameErr } = await supabase
      .from('stocks')
      .update({ product_code: targetCode })
      .eq('product_code', sourceCode)
    if (stockRenameErr) throw new Error(`stocks rename: ${stockRenameErr.message}`)
  }

  const { error: deleteErr } = await supabase.from('products').delete().eq('product_code', sourceCode)
  if (deleteErr) throw new Error(`products delete: ${deleteErr.message}`)
}

async function main() {
  const targetDate = resolveTargetDate()
  const range = jstDayRange(targetDate)

  console.log(`=== ${targetDate} (JST) に取り込まれた 00 付きコードの振替 ===`)
  console.log(`範囲: ${range.start} 〜 ${range.end}`)

  const [movements, productsToday, allProductCodes] = await Promise.all([
    fetchMovementsInRange(range),
    fetchProductsInRange(range),
    fetchAllProductCodes(),
  ])

  const candidates = new Map()

  for (const row of movements) {
    const code = String(row.product_code || '').trim()
    if (!isZeroPrefixNumericCode(code)) continue
    if (!candidates.has(code)) {
      candidates.set(code, { sourceCode: code, reasons: new Set(['stock_movements']) })
    } else {
      candidates.get(code).reasons.add('stock_movements')
    }
  }

  for (const row of productsToday) {
    const code = String(row.product_code || '').trim()
    if (!isZeroPrefixNumericCode(code)) continue
    if (!candidates.has(code)) {
      candidates.set(code, {
        sourceCode: code,
        targetCode: toTargetCode(code),
        name: row.name || '',
        reasons: new Set(['products.created_at']),
      })
    } else {
      candidates.get(code).reasons.add('products.created_at')
      if (!candidates.get(code).name) candidates.get(code).name = row.name || ''
    }
  }

  if (candidates.size === 0) {
    console.log('振替対象はありません')
    return
  }

  const plans = []
  for (const [sourceCode, info] of candidates) {
    const targetCode = toTargetCode(sourceCode)
    if (sourceCode === targetCode) continue

    const { data: sourceProduct } = await supabase
      .from('products')
      .select('product_code, name')
      .eq('product_code', sourceCode)
      .maybeSingle()

    if (!sourceProduct) {
      plans.push({
        sourceCode,
        targetCode,
        action: 'skip',
        reason: '00付き商品マスタが存在しない（履歴のみ）',
        reasons: [...info.reasons],
      })
      continue
    }

    plans.push({
      sourceCode,
      targetCode,
      name: sourceProduct.name || info.name || '',
      action: allProductCodes.has(targetCode) ? 'merge' : 'rename',
      reasons: [...info.reasons],
    })
  }

  const actionable = plans.filter((p) => p.action !== 'skip')
  console.log(`\n対象: ${actionable.length} 件（スキップ ${plans.length - actionable.length} 件）`)
  for (const plan of actionable.slice(0, 30)) {
    console.log(
      `[${plan.action}] ${plan.sourceCode} → ${plan.targetCode} | ${plan.name} | ${plan.reasons.join(', ')}`
    )
  }
  if (actionable.length > 30) {
    console.log(`…他 ${actionable.length - 30} 件`)
  }

  if (!apply) {
    console.log('\n※ 実行するには --apply を付けて再実行してください')
    return
  }

  console.log('\n=== 実行中 ===')
  const results = []
  let merged = 0
  let renamed = 0
  let errors = 0

  for (const plan of actionable) {
    try {
      if (plan.action === 'merge') {
        await mergeIntoExisting(plan.sourceCode, plan.targetCode)
        merged += 1
        results.push({ ...plan, status: 'merged' })
        console.log(`✓ 統合: ${plan.sourceCode} → ${plan.targetCode}`)
      } else {
        await renameProduct(plan.sourceCode, plan.targetCode)
        renamed += 1
        results.push({ ...plan, status: 'renamed' })
        console.log(`✓ 振替: ${plan.sourceCode} → ${plan.targetCode}`)
      }
    } catch (err) {
      errors += 1
      const message = err instanceof Error ? err.message : String(err)
      results.push({ ...plan, status: 'error', error: message })
      console.error(`✗ ${plan.sourceCode}: ${message}`)
    }
  }

  const outDir = path.join(__dirname, '..', 'exports')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `migrate-today-00-${targetDate}.json`)
  fs.writeFileSync(outPath, JSON.stringify({ targetDate, results }, null, 2), 'utf8')

  console.log('\n=== 完了 ===')
  console.log(`振替: ${renamed}件 / 統合: ${merged}件 / エラー: ${errors}件`)
  console.log(`結果: ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
