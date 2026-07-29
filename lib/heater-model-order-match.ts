/**
 * D指令を機種マスタ（親）へ振り分けるマッチング
 * 優先: 明示heater_model > 型式/BOMコード一致 > 品名一致（一意）
 */

export type HeaterModelRef = {
  model: string
  name: string | null
}

export type WorkOrderMatchInput = {
  id?: string
  heater_model?: string | null
  model?: string | null
  bom_model?: string | null
  product_name?: string | null
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()
}

function modelFieldContainsCode(field: string, code: string): boolean {
  const f = field.trim()
  const c = code.trim()
  if (!f || !c) return false
  if (f === c) return true
  if (f.endsWith(c)) return true
  if (f.includes(` ${c}`) || f.includes(`/${c}`) || f.includes(`-${c}`)) return true
  // 「SGR-600 光合成…」先頭一致
  if (f.startsWith(`${c} `) || f.startsWith(`${c}/`)) return true
  return false
}

export type ModelMatchResult = {
  model: string
  reason: 'heater_model' | 'model_code' | 'bom_model' | 'product_name'
  explicit: boolean
}

/** 1件のD指令に対する最適な親機種を返す（複数候補時はコード一致を優先） */
export function resolveHeaterModelForOrder(
  order: WorkOrderMatchInput,
  heaterModels: HeaterModelRef[]
): ModelMatchResult | null {
  if (!heaterModels.length) return null

  const heater = String(order.heater_model || '').trim()
  if (heater) {
    const hit = heaterModels.find((m) => m.model === heater)
    if (hit) {
      return { model: hit.model, reason: 'heater_model', explicit: true }
    }
  }

  const orderModel = String(order.model || '').trim()
  const bomModel = String(order.bom_model || '').trim()

  // 型式が機種コードそのもの／含む
  const byModelCode = heaterModels.filter((m) => modelFieldContainsCode(orderModel, m.model))
  if (byModelCode.length === 1) {
    return { model: byModelCode[0].model, reason: 'model_code', explicit: false }
  }
  if (byModelCode.length > 1) {
    // より長いコード一致を優先（SGR-600 と SGR-6 など）
    const best = [...byModelCode].sort((a, b) => b.model.length - a.model.length)[0]
    return { model: best.model, reason: 'model_code', explicit: false }
  }

  const byBom = heaterModels.filter((m) => modelFieldContainsCode(bomModel, m.model))
  if (byBom.length === 1) {
    return { model: byBom[0].model, reason: 'bom_model', explicit: false }
  }
  if (byBom.length > 1) {
    const best = [...byBom].sort((a, b) => b.model.length - a.model.length)[0]
    return { model: best.model, reason: 'bom_model', explicit: false }
  }

  // 製品名＝機種名（同名機種が1つだけのとき）
  const productKey = normalizeText(order.product_name)
  if (productKey) {
    const byName = heaterModels.filter((m) => normalizeText(m.name) === productKey)
    if (byName.length === 1) {
      return { model: byName[0].model, reason: 'product_name', explicit: false }
    }
    // 同名が複数（SGR-300/600 など）→ 型式にコードが含まれるものだけ
    if (byName.length > 1 && orderModel) {
      const narrowed = byName.filter((m) => modelFieldContainsCode(orderModel, m.model))
      if (narrowed.length === 1) {
        return { model: narrowed[0].model, reason: 'model_code', explicit: false }
      }
      if (narrowed.length > 1) {
        const best = [...narrowed].sort((a, b) => b.model.length - a.model.length)[0]
        return { model: best.model, reason: 'model_code', explicit: false }
      }
    }
  }

  return null
}

/** 全D指令を機種ごとに振り分け（1指令は1機種のみ） */
export function groupOrdersByHeaterModel<T extends WorkOrderMatchInput>(
  orders: T[],
  heaterModels: HeaterModelRef[]
): {
  byModel: Map<string, Array<T & { _match: ModelMatchResult }>>
  unlinked: T[]
} {
  const byModel = new Map<string, Array<T & { _match: ModelMatchResult }>>()
  for (const m of heaterModels) {
    byModel.set(m.model, [])
  }
  const unlinked: T[] = []

  for (const order of orders) {
    const match = resolveHeaterModelForOrder(order, heaterModels)
    if (!match || !byModel.has(match.model)) {
      unlinked.push(order)
      continue
    }
    byModel.get(match.model)!.push({ ...order, _match: match })
  }

  return { byModel, unlinked }
}
