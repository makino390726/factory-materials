import type { SupabaseClient } from '@supabase/supabase-js'

export type PartCommonality = {
  part_key: string
  part_name: string | null
  bom_model_count: number
  total_bom_models: number
  models: string[]
  common_group_label: string
  is_all_models: boolean
  is_multi_model: boolean
  family_label: string
  df_uf_lt_label: string
}

export function modelFamily(model: string): string {
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

export function familySetLabel(models: string[]): string {
  const fams = [...new Set(models.map(modelFamily))].sort()
  if (fams.length === 1) return `${fams[0]}のみ`
  return `${fams.join('・')}共通`
}

export function dfUfLtLabel(models: string[]): string {
  const hasDF = models.some((m) => m.includes('-DF') || m.endsWith('LT-DF'))
  const hasUF = models.some((m) => m.includes('-UF'))
  const hasLT = models.some((m) => /LT/.test(m) && !m.includes('-DF'))
  const bits: string[] = []
  if (hasDF) bits.push('DF')
  if (hasUF) bits.push('UF')
  if (hasLT) bits.push('LT')
  return bits.join('/') || '-'
}

export function buildCommonGroupLabel(models: string[], totalBomModels: number): string {
  if (models.length === 0) return '単独/未登録'
  if (models.length === totalBomModels) return '全機種'
  if (models.length === 1) return `${models[0]}のみ`
  return `${models.length}機種 ${familySetLabel(models)}`
}

async function fetchAllBomModels(supabase: SupabaseClient): Promise<string[]> {
  const pageSize = 1000
  let from = 0
  const models = new Set<string>()

  while (true) {
    const { data, error } = await supabase
      .from('heater_bom')
      .select('model')
      .range(from, from + pageSize - 1)

    if (error) throw error
    if (!data?.length) break

    for (const row of data) {
      const model = String(row.model || '').trim()
      if (model) models.add(model)
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  return [...models].sort()
}

/** BOMから部品の共通明細を自動検出 */
export async function getPartCommonalityFromBom(
  supabase: SupabaseClient,
  partKey: string
): Promise<PartCommonality> {
  const normalizedKey = partKey.trim()
  const [allModels, bomResult, partResult] = await Promise.all([
    fetchAllBomModels(supabase),
    supabase.from('heater_bom').select('model').eq('part_key', normalizedKey),
    supabase
      .from('heater_parts_master')
      .select('part_name')
      .eq('part_key', normalizedKey)
      .maybeSingle(),
  ])

  if (bomResult.error) throw bomResult.error

  const models = [...new Set((bomResult.data || []).map((row) => String(row.model || '').trim()))]
    .filter(Boolean)
    .sort()

  const totalBomModels = allModels.length

  return {
    part_key: normalizedKey,
    part_name: partResult.data?.part_name ?? null,
    bom_model_count: models.length,
    total_bom_models: totalBomModels,
    models,
    common_group_label: buildCommonGroupLabel(models, totalBomModels),
    is_all_models: models.length > 0 && models.length === totalBomModels,
    is_multi_model: models.length >= 2,
    family_label: familySetLabel(models),
    df_uf_lt_label: dfUfLtLabel(models),
  }
}

export function parseAllocationModels(value: unknown): string[] | null {
  if (!value) return null
  if (Array.isArray(value)) {
    const models = value.map((item) => String(item || '').trim()).filter(Boolean)
    return models.length > 0 ? models : null
  }
  return null
}
