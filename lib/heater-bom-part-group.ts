import type { ProductCategory } from '@/lib/product-category'

export const UNCATEGORIZED_BOM_GROUP = '未分類' as const

/** 製品カテゴリ別の初期グループ名テンプレート */
export const DEFAULT_BOM_GROUPS_BY_CATEGORY: Record<ProductCategory, string[]> = {
  暖房機: ['発生機上段', '発生機下段', '工費', '梱包'],
  たばこ乾燥機: ['本体', '付属品', '工費', '梱包'],
  食品乾燥機: ['本体', '付属品', '工費', '梱包'],
  光合成促進装置: ['本体', '付属品', '工費', '梱包'],
  作業器機: ['本体', '付属品', '工費', '梱包'],
  その他: ['本体', '付属品', '工費', '梱包'],
}

export type BomGroupDefinition = {
  group_name: string
  sort_order: number
}

function compact(text: string) {
  return text.replace(/\s+/g, '')
}

export function getDefaultBomGroupsForCategory(category: ProductCategory): BomGroupDefinition[] {
  return (DEFAULT_BOM_GROUPS_BY_CATEGORY[category] || DEFAULT_BOM_GROUPS_BY_CATEGORY['その他']).map(
    (group_name, sort_order) => ({ group_name, sort_order })
  )
}

export function buildGroupSortMap(groups: BomGroupDefinition[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const g of groups) {
    map.set(g.group_name, Number(g.sort_order ?? 0))
  }
  map.set(UNCATEGORIZED_BOM_GROUP, 9999)
  return map
}

export function sortBomPartRowsWithGroups<T extends {
  part_group?: string | null
  sort_order?: number | null
  part_key?: string
}>(rows: T[], groupSortMap: Map<string, number>): T[] {
  return [...rows].sort((a, b) => {
    const ga = groupSortMap.get(String(a.part_group || UNCATEGORIZED_BOM_GROUP)) ?? 9998
    const gb = groupSortMap.get(String(b.part_group || UNCATEGORIZED_BOM_GROUP)) ?? 9998
    if (ga !== gb) return ga - gb
    const sa = Number(a.sort_order ?? 0)
    const sb = Number(b.sort_order ?? 0)
    if (sa !== sb) return sa - sb
    return String(a.part_key || '').localeCompare(String(b.part_key || ''), 'ja-JP')
  })
}

/** パーツ名からグループを推定（カテゴリのテンプレート名に合わせる） */
export function inferBomPartGroup(
  partKey: string,
  partName: string | null | undefined,
  categoryGroups: string[]
): string {
  const key = compact(String(partKey || ''))
  const name = compact(String(partName || ''))
  const text = `${key}${name}`

  const has = (label: string) => categoryGroups.includes(label)

  if (
    text.includes('工費') ||
    text.includes('工賃') ||
    key.includes('工費') ||
    key.includes('工賃')
  ) {
    if (has('工費')) return '工費'
  }

  if (
    text.includes('ダンボール') ||
    text.includes('梱包') ||
    text.includes('木箱') ||
    text.includes('包装') ||
    text.includes('発泡') ||
    text.includes('パレット')
  ) {
    if (has('梱包')) return '梱包'
  }

  if (text.includes('発生機上段') || (text.includes('発生機') && text.includes('上段'))) {
    if (has('発生機上段')) return '発生機上段'
    if (has('本体')) return '本体'
  }

  if (text.includes('発生機下段') || (text.includes('発生機') && text.includes('下段'))) {
    if (has('発生機下段')) return '発生機下段'
    if (has('本体')) return '本体'
  }

  if (text.includes('付属') || text.includes('オプション')) {
    if (has('付属品')) return '付属品'
  }

  return UNCATEGORIZED_BOM_GROUP
}

export function normalizeBomPartGroup(
  rawGroup: string | null | undefined,
  partKey: string,
  partName: string | null | undefined,
  allowedGroups: string[]
): string {
  const trimmed = String(rawGroup || '').trim()
  if (trimmed && (allowedGroups.includes(trimmed) || trimmed === UNCATEGORIZED_BOM_GROUP)) {
    return trimmed
  }
  return inferBomPartGroup(partKey, partName, allowedGroups)
}

/** 旧固定グループ名との互換（表示順フォールバック） */
export const LEGACY_BOM_PART_GROUP_ORDER = [
  '発生機上段',
  '発生機下段',
  '工費',
  '梱包',
  UNCATEGORIZED_BOM_GROUP,
] as const

export function getBomPartGroupSortIndex(group: string, groupSortMap?: Map<string, number>): number {
  if (groupSortMap?.has(group)) return groupSortMap.get(group)!
  const idx = LEGACY_BOM_PART_GROUP_ORDER.indexOf(group as (typeof LEGACY_BOM_PART_GROUP_ORDER)[number])
  return idx >= 0 ? idx : LEGACY_BOM_PART_GROUP_ORDER.length
}

/** @deprecated sortBomPartRowsWithGroups を使用 */
export function sortBomPartRows<T extends {
  part_group?: string | null
  sort_order?: number | null
  part_key?: string
}>(rows: T[]): T[] {
  const legacyMap = buildGroupSortMap(
    LEGACY_BOM_PART_GROUP_ORDER.filter((g) => g !== UNCATEGORIZED_BOM_GROUP).map((group_name, sort_order) => ({
      group_name,
      sort_order,
    }))
  )
  return sortBomPartRowsWithGroups(rows, legacyMap)
}
