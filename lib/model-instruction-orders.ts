/** D指令マスタに存在するが、工程管理では機種指令として扱う指令番号 */
export const MODEL_INSTRUCTION_ORDER_NOS = ['KR9-0001'] as const

export function normalizeOrderNo(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toUpperCase()
}

export function isModelInstructionOrderNo(orderNo: string | null | undefined) {
  const normalized = normalizeOrderNo(orderNo)
  if (!normalized) return false
  if (MODEL_INSTRUCTION_ORDER_NOS.some((code) => normalizeOrderNo(code) === normalized)) {
    return true
  }
  return normalized.startsWith('KR9-')
}