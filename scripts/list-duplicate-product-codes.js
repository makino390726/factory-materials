/**
 * 商品マスタで「00付き」と「00なし」が数値的に一致するペアを洗い出す
 * 実行: node --env-file=.env.local scripts/list-duplicate-product-codes.js
 */
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

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

function numericKey(code) {
  const trimmed = String(code || '').trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = parseInt(trimmed, 10)
  return Number.isNaN(n) ? null : String(n)
}

function findZeroPrefixPair(codes) {
  const set = new Set(codes)
  for (const code of codes) {
    if (!code.startsWith('00')) continue
    const stripped = code.slice(2)
    if (set.has(stripped)) {
      return { withZeros: code, withoutZeros: stripped }
    }
  }
  return null
}

function csvEscape(value) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

async function main() {
  const [products, stocks] = await Promise.all([
    fetchAll('products', 'id, product_code, name, purchase_price, cost_price, created_at'),
    fetchAll('stocks', 'product_code, stock_qty'),
  ])

  const stockMap = new Map(stocks.map((row) => [row.product_code, row.stock_qty]))

  const numericGroups = new Map()
  for (const product of products) {
    const code = String(product.product_code).trim()
    const key = numericKey(code)
    if (!key) continue
    if (!numericGroups.has(key)) numericGroups.set(key, [])
    numericGroups.get(key).push(product)
  }

  const pairs = []
  for (const [numKey, rows] of numericGroups) {
    if (rows.length < 2) continue
    const codes = rows.map((row) => row.product_code)
    const pair = findZeroPrefixPair(codes)
    if (!pair) continue

    const withRow = rows.find((row) => row.product_code === pair.withZeros)
    const withoutRow = rows.find((row) => row.product_code === pair.withoutZeros)

    pairs.push({
      numericKey: numKey,
      withoutZeros: {
        id: withoutRow?.id,
        product_code: pair.withoutZeros,
        name: withoutRow?.name || '',
        stock_qty: stockMap.get(pair.withoutZeros) ?? null,
        purchase_price: withoutRow?.purchase_price ?? null,
        cost_price: withoutRow?.cost_price ?? null,
      },
      withZeros: {
        id: withRow?.id,
        product_code: pair.withZeros,
        name: withRow?.name || '',
        stock_qty: stockMap.get(pair.withZeros) ?? null,
        purchase_price: withRow?.purchase_price ?? null,
        cost_price: withRow?.cost_price ?? null,
      },
    })
  }

  pairs.sort((a, b) =>
    a.withoutZeros.product_code.localeCompare(b.withoutZeros.product_code, 'ja', { numeric: true })
  )

  const productCodeSet = new Set(products.map((p) => String(p.product_code).trim()))
  const orphanWithZeros = []
  for (const product of products) {
    const code = String(product.product_code).trim()
    if (!/^\d+$/.test(code) || !code.startsWith('00')) continue
    const stripped = code.slice(2)
    if (productCodeSet.has(stripped)) continue
    orphanWithZeros.push({
      product_code: code,
      expected_canonical_code: stripped,
      name: product.name || '',
      stock_qty: stockMap.get(code) ?? null,
    })
  }
  orphanWithZeros.sort((a, b) =>
    a.product_code.localeCompare(b.product_code, 'ja', { numeric: true })
  )

  console.log(`商品マスタ総数: ${products.length}`)
  console.log(`00付き/なし 重複ペア数: ${pairs.length}`)
  console.log(`00付きのみ（対になる00なしコードなし）: ${orphanWithZeros.length}`)
  console.log('')
  console.log('canonical_code(00なし) | stock | duplicate_code(00付き) | stock | 商品名(00なし)')
  console.log('-'.repeat(100))

  for (const pair of pairs) {
    const a = pair.withoutZeros
    const b = pair.withZeros
    console.log(
      `${a.product_code.padEnd(12)} | ${String(a.stock_qty ?? '-').padStart(5)} | ${b.product_code.padEnd(12)} | ${String(b.stock_qty ?? '-').padStart(5)} | ${a.name}`
    )
  }

  if (orphanWithZeros.length > 0) {
    console.log('')
    console.log('【00付きのみ登録（対になる00なしコードは未登録）】')
    console.log('00付きコード   | expected(00なし) | stock | 商品名')
    console.log('-'.repeat(100))
    for (const row of orphanWithZeros) {
      console.log(
        `${row.product_code.padEnd(14)} | ${row.expected_canonical_code.padEnd(16)} | ${String(row.stock_qty ?? '-').padStart(5)} | ${row.name}`
      )
    }
  }

  const header = [
    'numeric_key',
    'canonical_code',
    'canonical_name',
    'canonical_stock',
    'canonical_purchase_price',
    'canonical_cost_price',
    'duplicate_code',
    'duplicate_name',
    'duplicate_stock',
    'duplicate_purchase_price',
    'duplicate_cost_price',
  ]

  const lines = [header.join(',')]
  for (const pair of pairs) {
    const a = pair.withoutZeros
    const b = pair.withZeros
    lines.push(
      [
        pair.numericKey,
        a.product_code,
        csvEscape(a.name),
        a.stock_qty ?? '',
        a.purchase_price ?? '',
        a.cost_price ?? '',
        b.product_code,
        csvEscape(b.name),
        b.stock_qty ?? '',
        b.purchase_price ?? '',
        b.cost_price ?? '',
      ].join(',')
    )
  }

  const outDir = path.join(__dirname, '..', 'exports')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'duplicate-product-code-pairs.csv')
  fs.writeFileSync(outPath, `\uFEFF${lines.join('\n')}`, 'utf8')

  const orphanHeader = [
    'product_code_00',
    'expected_canonical_code',
    'name',
    'stock_qty',
  ]
  const orphanLines = [orphanHeader.join(',')]
  for (const row of orphanWithZeros) {
    orphanLines.push(
      [
        row.product_code,
        row.expected_canonical_code,
        csvEscape(row.name),
        row.stock_qty ?? '',
      ].join(',')
    )
  }
  const orphanPath = path.join(outDir, 'orphan-00-product-codes.csv')
  fs.writeFileSync(orphanPath, `\uFEFF${orphanLines.join('\n')}`, 'utf8')

  console.log('')
  console.log(`重複ペアCSV: ${outPath}`)
  console.log(`00付きのみCSV: ${orphanPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
