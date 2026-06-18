/**
 * 00付きのみ登録されている商品コードを 00 なしの正規コードへリネーム
 * （対になる正規コードが既にある場合は統合）
 *
 * 診断のみ: node --env-file=.env.local scripts/rename-orphan-00-product-codes.js
 * 実行:     node --env-file=.env.local scripts/rename-orphan-00-product-codes.js --apply
 */
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const apply = process.argv.includes('--apply')

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

async function fetchAll(table, select) {
  const pageSize = 1000
  let from = 0
  let all = []
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order('product_code', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

function findOrphanWithZerosProducts(products) {
  const productCodeSet = new Set(products.map((p) => String(p.product_code).trim()))
  const orphans = []

  for (const product of products) {
    const sourceCode = String(product.product_code).trim()
    if (!/^\d+$/.test(sourceCode) || !sourceCode.startsWith('00')) continue
    const targetCode = sourceCode.slice(2)
    if (productCodeSet.has(targetCode)) continue
    orphans.push({
      id: product.id,
      sourceCode,
      targetCode,
      name: product.name || '',
      barcode: product.barcode || null,
    })
  }

  orphans.sort((a, b) => a.sourceCode.localeCompare(b.sourceCode, 'ja', { numeric: true }))
  return orphans
}

async function countRows(table, productCode) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('product_code', productCode)

  if (error) {
    if (String(error.message || '').includes('Could not find the table')) return 0
    throw error
  }
  return count || 0
}

async function updateProductCodeInTable(table, sourceCode, targetCode) {
  const { error } = await supabase
    .from(table)
    .update({ product_code: targetCode })
    .eq('product_code', sourceCode)

  if (error) {
    if (String(error.message || '').includes('Could not find the table')) return 0
    throw new Error(`${table}: ${error.message}`)
  }

  return await countRows(table, targetCode)
}

async function mergeIntoExisting(sourceCode, targetCode) {
  const { count: movementCount } = await supabase
    .from('stock_movements')
    .select('*', { count: 'exact', head: true })
    .eq('product_code', sourceCode)

  if (movementCount && movementCount > 0) {
    const { error } = await supabase
      .from('stock_movements')
      .update({ product_code: targetCode })
      .eq('product_code', sourceCode)
    if (error) throw new Error(`stock_movements: ${error.message}`)
  }

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

    const mergedQty = (targetStock?.stock_qty || 0) + (sourceStock.stock_qty || 0)
    const upsertPayload = {
      product_code: targetCode,
      stock_qty: mergedQty,
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

async function renameProduct(orphan) {
  const { sourceCode, targetCode, barcode } = orphan
  const movementCount = await countRows('stock_movements', sourceCode)

  if (movementCount > 0) {
    const { data: sourceProduct, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('product_code', sourceCode)
      .maybeSingle()

    if (fetchErr || !sourceProduct) {
      throw new Error(`products fetch: ${fetchErr?.message || 'not found'}`)
    }

    const nextBarcode =
      barcode && String(barcode).includes(sourceCode)
        ? String(barcode).replace(sourceCode, targetCode)
        : sourceProduct.barcode
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
      .select('stock_qty, unit_price, total_amount, shelf_no, updated_at')
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
    return
  }

  const productUpdate = { product_code: targetCode }
  if (barcode && String(barcode).includes(sourceCode)) {
    productUpdate.barcode = String(barcode).replace(sourceCode, targetCode)
  }

  const { error: productErr } = await supabase
    .from('products')
    .update(productUpdate)
    .eq('product_code', sourceCode)

  if (productErr) throw new Error(`products rename: ${productErr.message}`)

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

  for (const table of PRODUCT_CODE_TABLES) {
    await updateProductCodeInTable(table, sourceCode, targetCode)
  }
}

async function main() {
  const products = await fetchAll('products', 'id, product_code, name, barcode')
  const orphans = findOrphanWithZerosProducts(products)

  if (orphans.length === 0) {
    console.log('リネーム対象（00付きのみ）はありません')
    return
  }

  const productCodeSet = new Set(products.map((p) => String(p.product_code).trim()))
  const plans = []

  for (const orphan of orphans) {
    const existsTarget = productCodeSet.has(orphan.targetCode)
    const stockCount = await countRows('stocks', orphan.sourceCode)
    const movementCount = await countRows('stock_movements', orphan.sourceCode)
    plans.push({
      ...orphan,
      action: existsTarget ? 'merge' : 'rename',
      stockCount,
      movementCount,
    })
  }

  console.log(`=== 00付きのみ商品: ${plans.length} 件 ===`)
  for (const plan of plans) {
    console.log(
      `[${plan.action}] ${plan.sourceCode} → ${plan.targetCode} | stock=${plan.stockCount} movements=${plan.movementCount} | ${plan.name}`
    )
  }

  if (!apply) {
    console.log('\n※ 実行するには --apply を付けて再実行してください')
    return
  }

  console.log('\n=== 実行中 ===')
  const results = []
  let renamed = 0
  let merged = 0
  let errors = 0

  for (const plan of plans) {
    try {
      if (plan.action === 'merge') {
        await mergeIntoExisting(plan.sourceCode, plan.targetCode)
        merged += 1
        results.push({ ...plan, status: 'merged' })
        console.log(`✓ 統合: ${plan.sourceCode} → ${plan.targetCode}`)
      } else {
        await renameProduct(plan)
        renamed += 1
        results.push({ ...plan, status: 'renamed' })
        console.log(`✓ リネーム: ${plan.sourceCode} → ${plan.targetCode}`)
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
  const outPath = path.join(outDir, 'rename-orphan-00-results.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8')

  console.log('\n=== 完了 ===')
  console.log(`リネーム: ${renamed}件 / 統合: ${merged}件 / エラー: ${errors}件`)
  console.log(`結果: ${outPath}`)

  const remaining = findOrphanWithZerosProducts(await fetchAll('products', 'id, product_code, name, barcode'))
  console.log(`残り 00付きのみ: ${remaining.length}件`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
