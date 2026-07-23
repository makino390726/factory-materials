/**
 * heater_models / heater_manufacturing_plans に product_category を追加し、
 * 既存機種名からカテゴリを推定して埋める。
 *
 * 使い方: node scripts/migrate-add-product-category.js
 */
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let value = m[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = value
  }
}

function inferProductCategory(model, name) {
  const text = `${model || ''} ${name || ''}`
  if (/たばこ|タバコ|煙草|葉たばこ|葉タバコ/.test(text)) return 'たばこ乾燥機'
  if (/食品乾燥|食品用乾燥|フードドライ|食品ドライ/.test(text)) return '食品乾燥機'
  if (/光合成|促成装置|促進装置|CO2発生|炭酸ガス/.test(text)) return '光合成促進装置'
  if (/温風|暖房|ヒータ|ヒーター/.test(text)) return '暖房機'
  if (/乾燥機|ドライヤ|ドライヤー/.test(text)) return 'その他'
  return '暖房機'
}

async function ensureColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  if (!error) return true
  const msg = error.message || ''
  if (msg.includes(column) || error.code === 'PGRST204' || error.code === '42703') {
    return false
  }
  // table missing etc.
  throw new Error(`${table}.${column} 確認失敗: ${msg}`)
}

async function main() {
  loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です')
    process.exit(1)
  }

  const supabase = createClient(url, key)

  const modelsOk = await ensureColumn(supabase, 'heater_models', 'product_category')
  const plansOk = await ensureColumn(supabase, 'heater_manufacturing_plans', 'product_category')

  if (!modelsOk || !plansOk) {
    console.log('product_category 列がありません。')
    console.log('Supabase SQL Editor で migrate-add-product-category.sql を実行してください。')
    console.log('---')
    console.log(fs.readFileSync(path.join(__dirname, '..', 'migrate-add-product-category.sql'), 'utf8'))
    process.exit(2)
  }

  const { data: models, error: modelsError } = await supabase
    .from('heater_models')
    .select('model, name, product_category')
  if (modelsError) throw modelsError

  let updated = 0
  for (const row of models || []) {
    const current = row.product_category || '暖房機'
    // 既存がデフォルトのまま、かつ名前から別カテゴリが推定できる場合のみ更新
    if (current !== '暖房機') continue
    const inferred = inferProductCategory(row.model, row.name)
    if (inferred === '暖房機') continue
    const { error } = await supabase
      .from('heater_models')
      .update({ product_category: inferred })
      .eq('model', row.model)
    if (error) {
      console.warn('update fail', row.model, error.message)
      continue
    }
    updated += 1
    console.log(`分類: ${row.model} → ${inferred}`)
  }

  console.log(`完了: 機種 ${updated} 件を再分類`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
