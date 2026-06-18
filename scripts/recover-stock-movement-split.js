/**
 * 入庫取込で分裂した商品コード（00付き）を統合し、入出庫記録を元コードへ戻す
 *
 * 診断のみ: node --env-file=.env.local scripts/recover-stock-movement-split.js
 * 実行:     node --env-file=.env.local scripts/recover-stock-movement-split.js --apply
 */
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const apply = process.argv.includes('--apply')

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
    const { data, error } = await supabase.from(table).select(select).range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

/** 0085017800 → 85017800 のような 00 付き重複か */
function findZeroPrefixMerge(codes) {
  const set = new Set(codes)
  for (const code of codes) {
    if (!code.startsWith('00')) continue
    const stripped = code.slice(2)
    if (set.has(stripped)) {
      return { target: stripped, source: code }
    }
  }
  return null
}

async function main() {
  const [products, movements] = await Promise.all([
    fetchAll('products', 'product_code'),
    fetchAll('stock_movements', 'product_code, input_method'),
  ])

  const statsByCode = new Map()
  for (const m of movements) {
    const code = String(m.product_code || '').trim()
    if (!statsByCode.has(code)) statsByCode.set(code, { total: 0, manual: 0, batch: 0 })
    const s = statsByCode.get(code)
    s.total += 1
    if (m.input_method === 'batch_import') s.batch += 1
    else s.manual += 1
  }

  const numericGroups = new Map()
  for (const p of products) {
    const code = String(p.product_code || '').trim()
    if (!/^\d+$/.test(code)) continue
    const key = String(parseInt(code, 10))
    if (!numericGroups.has(key)) numericGroups.set(key, [])
    if (!numericGroups.get(key).includes(code)) numericGroups.get(key).push(code)
  }

  const mergePlans = []
  for (const [, codes] of numericGroups) {
    if (codes.length < 2) continue
    const pair = findZeroPrefixMerge(codes)
    if (!pair) continue
    mergePlans.push({
      ...pair,
      stats: {
        target: statsByCode.get(pair.target) || { total: 0, manual: 0, batch: 0 },
        source: statsByCode.get(pair.source) || { total: 0, manual: 0, batch: 0 },
      },
    })
  }

  mergePlans.sort((a, b) => a.target.localeCompare(b.target))

  if (mergePlans.length === 0) {
    console.log('統合対象の 00 付き重複コードは見つかりませんでした')
    return
  }

  const withMovements = mergePlans.filter((p) => p.stats.source.total > 0)
  console.log(`=== 統合プラン: ${mergePlans.length} グループ（うち履歴移行 ${withMovements.length} 件） ===`)
  for (const plan of withMovements.slice(0, 15)) {
    const s = plan.stats.source
    console.log(
      `  ${plan.source} → ${plan.target} (履歴 ${s.total}件: 手入力${s.manual} / 取込${s.batch})`
    )
  }
  if (withMovements.length > 15) {
    console.log(`  ... 他 ${withMovements.length - 15} 件`)
  }

  if (!apply) {
    console.log('\n※ 実行するには --apply を付けて再実行してください')
    return
  }

  console.log('\n=== 復旧実行中 ===')
  let movedMovements = 0
  let mergedStocks = 0
  let deletedProducts = 0
  let errors = 0

  for (const plan of mergePlans) {
    const { target, source } = plan

    const { count: sourceMoveCount } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('product_code', source)

    const { error: moveErr } = await supabase
      .from('stock_movements')
      .update({ product_code: target })
      .eq('product_code', source)

    if (moveErr) {
      console.error(`履歴移行失敗 ${source} → ${target}:`, moveErr.message)
      errors += 1
      continue
    }
    if (sourceMoveCount && sourceMoveCount > 0) {
      movedMovements += sourceMoveCount
    }

    const { data: sourceStock } = await supabase
      .from('stocks')
      .select('stock_qty, unit_price, total_amount, shelf_no')
      .eq('product_code', source)
      .maybeSingle()

    if (sourceStock) {
      const { data: targetStock } = await supabase
        .from('stocks')
        .select('stock_qty, unit_price, total_amount, shelf_no')
        .eq('product_code', target)
        .maybeSingle()

      const mergedQty = (targetStock?.stock_qty || 0) + (sourceStock.stock_qty || 0)
      const upsertPayload = {
        product_code: target,
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

      const { error: stockUpsertErr } = await supabase
        .from('stocks')
        .upsert(upsertPayload, { onConflict: 'product_code' })

      if (stockUpsertErr) {
        console.error(`在庫統合失敗 ${source} → ${target}:`, stockUpsertErr.message)
        errors += 1
      } else {
        mergedStocks += 1
      }

      await supabase.from('stocks').delete().eq('product_code', source)
    }

    const { error: deleteProductErr } = await supabase.from('products').delete().eq('product_code', source)

    if (deleteProductErr) {
      console.error(`商品削除失敗 ${source}:`, deleteProductErr.message)
      errors += 1
    } else {
      deletedProducts += 1
    }
  }

  console.log('\n=== 完了 ===')
  console.log(`移行した履歴: ${movedMovements}件`)
  console.log(`統合した在庫: ${mergedStocks}件`)
  console.log(`削除した重複商品: ${deletedProducts}件`)
  if (errors > 0) console.log(`エラー: ${errors}件`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
