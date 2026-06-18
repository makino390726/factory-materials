/**
 * 複数機種に共通するBOMパーツを、機種グループ別にリストアップ
 * 実行: node --env-file=.env.local scripts/list-common-parts-by-model-group.js
 */
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchAll(table, select) {
  const pageSize = 1000
  let from = 0
  let all = []
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

function modelFamily(model) {
  const m = String(model)
  if (/^110/.test(m)) return '110系'
  if (/^150/.test(m)) return '150系'
  if (/^200/.test(m)) return '200系'
  if (/^300/.test(m)) return '300系'
  if (/^400/.test(m)) return '400系'
  if (/^500/.test(m)) return '500系'
  if (/^600/.test(m)) return '600系'
  if (/^700/.test(m)) return '700系'
  if (/^800/.test(m)) return '800系'
  return 'その他'
}

function familySetLabel(models) {
  const fams = [...new Set(models.map(modelFamily))].sort()
  if (fams.length === 1) return `${fams[0]}のみ`
  return `${fams.join('・')}共通`
}

function dfUfLtLabel(models) {
  const hasDF = models.some((m) => m.includes('-DF') || m.endsWith('LT-DF'))
  const hasUF = models.some((m) => m.includes('-UF'))
  const hasLT = models.some((m) => /LT/.test(m) && !m.includes('-DF'))
  const bits = []
  if (hasDF) bits.push('DF')
  if (hasUF) bits.push('UF')
  if (hasLT) bits.push('LT')
  return bits.join('/') || '-'
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

async function main() {
  const bom = await fetchAll('heater_bom', 'model, part_key, part_name, quantity')
  const parts = await fetchAll('heater_parts_master', 'part_key, part_name, product_code, cost_price')
  const partMaster = new Map(parts.map((p) => [p.part_key, p]))

  const allModels = [...new Set(bom.map((b) => b.model))].sort()
  const totalModels = allModels.length

  const partMap = new Map()
  for (const row of bom) {
    if (!partMap.has(row.part_key)) {
      partMap.set(row.part_key, { models: new Set(), part_name: row.part_name })
    }
    partMap.get(row.part_key).models.add(row.model)
  }

  const shared = []
  for (const [part_key, info] of partMap) {
    const models = [...info.models].sort()
    if (models.length < 2) continue
    const master = partMaster.get(part_key)
    shared.push({
      part_key,
      part_name: info.part_name || master?.part_name || '',
      product_code: master?.product_code || '',
      cost_price: master?.cost_price ?? '',
      model_count: models.length,
      models,
      model_set_key: models.join('|'),
      family_label: familySetLabel(models),
      df_uf_lt_label: dfUfLtLabel(models),
      is_all_models: models.length === totalModels,
    })
  }

  shared.sort(
    (a, b) => b.model_count - a.model_count || a.part_key.localeCompare(b.part_key)
  )

  const groups = new Map()
  for (const part of shared) {
    if (!groups.has(part.model_set_key)) {
      groups.set(part.model_set_key, { models: part.models, parts: [] })
    }
    groups.get(part.model_set_key).parts.push(part)
  }

  const groupList = [...groups.values()]
    .map((group) => ({
      model_count: group.models.length,
      models: group.models,
      family_label: familySetLabel(group.models),
      df_uf_lt_label: dfUfLtLabel(group.models),
      part_count: group.parts.length,
      is_all_models: group.models.length === totalModels,
      parts: group.parts.sort((a, b) => a.part_key.localeCompare(b.part_key)),
    }))
    .sort((a, b) => b.model_count - a.model_count || b.part_count - a.part_count)

  console.log(`BOM登録機種: ${totalModels}機種`)
  console.log(allModels.join(', '))
  console.log(`2機種以上共通パーツ: ${shared.length}件`)
  console.log(`機種集合グループ: ${groupList.length}種類`)
  console.log('')
  console.log('=== グループ別サマリ ===')

  for (const group of groupList) {
    const category = group.is_all_models
      ? '全機種'
      : `${group.model_count}機種 / ${group.family_label} / ${group.df_uf_lt_label}`
    console.log(`【${category}】 パーツ${group.part_count}件`)
    console.log(`  機種: ${group.models.join(', ')}`)
    console.log(
      `  例: ${group.parts
        .slice(0, 5)
        .map((p) => `${p.part_key}(${p.part_name})`)
        .join(' / ')}${group.part_count > 5 ? ' ...' : ''}`
    )
    console.log('')
  }

  const detailLines = [
    [
      'category',
      'model_count',
      'capacity_families',
      'df_uf_lt_type',
      'models',
      'part_key',
      'part_name',
      'product_code',
      'cost_price',
    ].join(','),
  ]

  for (const group of groupList) {
    const category = group.is_all_models
      ? '全機種'
      : `${group.model_count}機種_${group.family_label}`
    for (const part of group.parts) {
      detailLines.push(
        [
          csvEscape(category),
          group.model_count,
          csvEscape(group.family_label),
          csvEscape(group.df_uf_lt_label),
          csvEscape(group.models.join(' / ')),
          csvEscape(part.part_key),
          csvEscape(part.part_name),
          csvEscape(part.product_code),
          part.cost_price,
        ].join(',')
      )
    }
  }

  const summaryLines = [
  'category,model_count,capacity_families,df_uf_lt_type,models,part_count',
  ]
  for (const group of groupList) {
    const category = group.is_all_models
      ? '全機種'
      : `${group.model_count}機種_${group.family_label}`
    summaryLines.push(
      [
        csvEscape(category),
        group.model_count,
        csvEscape(group.family_label),
        csvEscape(group.df_uf_lt_label),
        csvEscape(group.models.join(' / ')),
        group.part_count,
      ].join(',')
    )
  }

  const outDir = path.join(__dirname, '..', 'exports')
  fs.mkdirSync(outDir, { recursive: true })
  const detailPath = path.join(outDir, 'common-parts-by-model-group.csv')
  const summaryPath = path.join(outDir, 'common-parts-by-model-group-summary.csv')
  fs.writeFileSync(detailPath, `\uFEFF${detailLines.join('\n')}`, 'utf8')
  fs.writeFileSync(summaryPath, `\uFEFF${summaryLines.join('\n')}`, 'utf8')

  console.log(`詳細CSV: ${detailPath}`)
  console.log(`サマリCSV: ${summaryPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
