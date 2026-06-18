/**
 * 入庫取込による商品コード分裂の診断
 * 実行: node --env-file=.env.local scripts/diagnose-stock-movement-split.js
 */
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

function numericKey(code) {
  const n = parseInt(String(code || '').trim(), 10)
  if (Number.isNaN(n)) return null
  return String(n)
}

async function main() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayIso = todayStart.toISOString()

  const { data: todayImports, error: importErr } = await supabase
    .from('stock_movements')
    .select('id, product_code, movement, qty, input_method, created_at')
    .eq('input_method', 'batch_import')
    .gte('updated_at', todayIso)
    .order('created_at', { ascending: false })
    .limit(5)

  // batch_import は updated_at が無い可能性 → created_at でも試す
  const { data: todayByCreated, error: createdErr } = await supabase
    .from('stock_movements')
    .select('id, product_code, movement, qty, input_method, created_at')
    .eq('input_method', 'batch_import')
    .gte('created_at', todayIso)

  const { data: allMovements, error: movErr } = await supabase
    .from('stock_movements')
    .select('product_code, input_method, created_at')
    .order('created_at', { ascending: false })
    .limit(5000)

  if (movErr) {
    console.error('movements error:', movErr)
    process.exit(1)
  }

  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('product_code, name, created_at')

  if (prodErr) {
    console.error('products error:', prodErr)
    process.exit(1)
  }

  const movementCountByCode = new Map()
  const nonBatchByCode = new Map()
  const batchByCode = new Map()

  for (const m of allMovements || []) {
    const code = String(m.product_code || '').trim()
    movementCountByCode.set(code, (movementCountByCode.get(code) || 0) + 1)
    if (m.input_method === 'batch_import') {
      batchByCode.set(code, (batchByCode.get(code) || 0) + 1)
    } else {
      nonBatchByCode.set(code, (nonBatchByCode.get(code) || 0) + 1)
    }
  }

  const productCodes = new Set((products || []).map((p) => String(p.product_code).trim()))
  const numericGroups = new Map()

  for (const code of productCodes) {
    const key = numericKey(code)
    if (!key) continue
    if (!numericGroups.has(key)) numericGroups.set(key, [])
    numericGroups.get(key).push(code)
  }

  const splits = []
  for (const [numKey, codes] of numericGroups) {
    if (codes.length < 2) continue
    const details = codes.map((code) => ({
      code,
      total: movementCountByCode.get(code) || 0,
      manual: nonBatchByCode.get(code) || 0,
      batch: batchByCode.get(code) || 0,
    }))
    const hasManualOnOne = details.some((d) => d.manual > 0)
    const hasBatchOnOther = details.some((d) => d.batch > 0)
    if (hasManualOnOne && hasBatchOnOther) {
      splits.push({ numericKey: numKey, codes: details })
    }
  }

  console.log('=== 今日の batch_import 件数 (created_at) ===')
  console.log(todayByCreated?.length ?? 0, createdErr?.message || '')
  console.log('=== 商品コード分裂（手入力履歴と取込履歴が別コード） ===')
  console.log('該当グループ数:', splits.length)
  for (const s of splits.slice(0, 20)) {
    console.log(JSON.stringify(s, null, 2))
  }

  // 取込のみのコードで、数値一致する別コードに手入力履歴がある
  const orphanBatch = []
  for (const code of batchByCode.keys()) {
    if (nonBatchByCode.has(code)) continue
    const key = numericKey(code)
    if (!key) continue
    const siblings = numericGroups.get(key) || []
    for (const sibling of siblings) {
      if (sibling !== code && (nonBatchByCode.get(sibling) || 0) > 0) {
        orphanBatch.push({
          importCode: code,
          originalCode: sibling,
          importMovements: batchByCode.get(code),
          originalManual: nonBatchByCode.get(sibling),
        })
      }
    }
  }

  console.log('=== 復旧候補（取込コード → 元コード） ===')
  console.log('件数:', orphanBatch.length)
  for (const o of orphanBatch.slice(0, 30)) {
    console.log(o)
  }

  const { count: totalMovements } = await supabase
    .from('stock_movements')
    .select('*', { count: 'exact', head: true })

  console.log('=== stock_movements 総件数 ===', totalMovements)
}

main().catch(console.error)
