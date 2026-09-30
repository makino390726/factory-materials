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

export const COMPLETED_QTY_VALIDATION_MESSAGE =
  '完成個数は0以上の整数で入力してください'

export const PART_OUTPUT_QTY_VALIDATION_MESSAGE =
  'パーツの制作数は0以上の整数で入力してください'

export function parsePartOutputs(
  value: unknown,
  hasLine: boolean
): Array<{ part_key: string; produced_qty: number }> {
  if (!hasLine || !Array.isArray(value)) return []
  const rows: Array<{ part_key: string; produced_qty: number }> = []
  for (const row of value) {
    const partKey = String((row as { part_key?: unknown })?.part_key || '').trim()
    if (!partKey) continue
    const raw = (row as { produced_qty?: unknown })?.produced_qty
    if (raw === null || raw === undefined || raw === '') continue
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim())
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      throw new Error(PART_OUTPUT_QTY_VALIDATION_MESSAGE)
    }
    rows.push({ part_key: partKey, produced_qty: parsed })
  }
  return rows
}

/** L指令がある行だけ完成個数を受け付ける。未入力は null（任意） */
export function parseOptionalCompletedQty(
  value: unknown,
  hasLine: boolean
): number | null {
  if (!hasLine) return null
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(COMPLETED_QTY_VALIDATION_MESSAGE)
  }
  return parsed
}

export function validateWorkReportItem(item: {
  instruction_text?: unknown
  line_id?: unknown
  work_type?: unknown
  completed_qty?: unknown
  part_outputs?: unknown
}): string | null {
  if (!isDirectOrIndirectWorkType(item.work_type)) {
    return WORK_TYPE_VALIDATION_MESSAGE
  }
  // 直接費（直接）の場合のみ D指令・L指令のいずれかが必須。間接は未入力可。
  if (isDirectWorkType(item.work_type) && !hasInstructionOrLine(item)) {
    return WORK_TARGET_VALIDATION_MESSAGE
  }
  const lineId =
    typeof item.line_id === 'string'
      ? item.line_id.trim()
      : item.line_id != null
        ? String(item.line_id).trim()
        : ''
  if (item.completed_qty !== undefined && item.completed_qty !== null && item.completed_qty !== '') {
    try {
      parseOptionalCompletedQty(item.completed_qty, Boolean(lineId))
    } catch (error) {
      return error instanceof Error ? error.message : COMPLETED_QTY_VALIDATION_MESSAGE
    }
  }
  try {
    parsePartOutputs(item.part_outputs, Boolean(lineId))
  } catch (error) {
    return error instanceof Error ? error.message : PART_OUTPUT_QTY_VALIDATION_MESSAGE
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
