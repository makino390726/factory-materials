/**
 * 生産計画・機種マスタ用の製品カテゴリ
 */
export const PRODUCT_CATEGORIES = [
  '暖房機',
  'たばこ乾燥機',
  '食品乾燥機',
  '光合成促進装置',
  'その他',
] as const

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

export const DEFAULT_PRODUCT_CATEGORY: ProductCategory = '暖房機'

export function isProductCategory(value: unknown): value is ProductCategory {
  return (
    typeof value === 'string' &&
    (PRODUCT_CATEGORIES as readonly string[]).includes(value)
  )
}

export function normalizeProductCategory(value: unknown): ProductCategory {
  if (isProductCategory(value)) return value
  return DEFAULT_PRODUCT_CATEGORY
}

/** 暖房機のみ heater_bom 原価。それ以外は D指令原価を参照 */
export function isHeaterProductCategory(value: unknown): boolean {
  return normalizeProductCategory(value) === '暖房機'
}

/** 機種名・コードからカテゴリを推定（既存データの初期分類用） */
export function inferProductCategory(model: string, name?: string | null): ProductCategory {
  const text = `${model} ${name || ''}`
  if (/たばこ|タバコ|煙草|葉たばこ|葉タバコ/.test(text)) return 'たばこ乾燥機'
  if (/食品乾燥|食品用乾燥|フードドライ|食品ドライ/.test(text)) return '食品乾燥機'
  if (/光合成|促成装置|促進装置|CO2発生|炭酸ガス/.test(text)) return '光合成促進装置'
  if (/温風|暖房|ヒータ|ヒーター/.test(text)) return '暖房機'
  if (/乾燥機|ドライヤ|ドライヤー/.test(text)) return 'その他'
  return DEFAULT_PRODUCT_CATEGORY
}
