export function isDirectWorkType(workType: unknown): boolean {
  const t = typeof workType === 'string' ? workType.trim() : ''
  return t === '直接'
}

export function isIndirectWorkType(workType: unknown): boolean {
  const t = typeof workType === 'string' ? workType.trim() : ''
  return t === '間接'
}

export function isDirectOrIndirectWorkType(workType: unknown): boolean {
  return isDirectWorkType(workType) || isIndirectWorkType(workType)
}

export function hasInstructionOrLine(item: {
  instruction_text?: unknown
  line_id?: unknown
}): boolean {
  const instruction =
    typeof item.instruction_text === 'string' ? item.instruction_text.trim() : ''
  const lineId =
    typeof item.line_id === 'string'
      ? item.line_id.trim()
      : item.line_id != null
        ? String(item.line_id).trim()
        : ''
  return Boolean(instruction) || Boolean(lineId)
}

export const WORK_TYPE_VALIDATION_MESSAGE =
  '作業区分（直接・間接）を選択してください'

export const WORK_TARGET_VALIDATION_MESSAGE =
  'D指令・L指令のいずれかを選択してください'

export function validateWorkReportItem(item: {
  instruction_text?: unknown
  line_id?: unknown
  work_type?: unknown
}): string | null {
  if (!isDirectOrIndirectWorkType(item.work_type)) {
    return WORK_TYPE_VALIDATION_MESSAGE
  }
  // 直接費（直接）の場合のみ D指令・L指令のいずれかが必須。間接は未入力可。
  if (isDirectWorkType(item.work_type) && !hasInstructionOrLine(item)) {
    return WORK_TARGET_VALIDATION_MESSAGE
  }
  return null
}

/** @deprecated validateWorkReportItem を使用 */
export function hasWorkTarget(item: {
  instruction_text?: unknown
  line_id?: unknown
  work_type?: unknown
}): boolean {
  return validateWorkReportItem(item) === null
}
