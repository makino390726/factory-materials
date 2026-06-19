export function isDirectOrIndirectWorkType(workType: unknown): boolean {
  const t = typeof workType === 'string' ? workType.trim() : ''
  return t === '直接' || t === '間接'
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

export function hasWorkTarget(item: {
  instruction_text?: unknown
  line_id?: unknown
  work_type?: unknown
}): boolean {
  return hasInstructionOrLine(item) || isDirectOrIndirectWorkType(item.work_type)
}

export const WORK_TARGET_VALIDATION_MESSAGE =
  'D指令・L指令のいずれか、または作業区分（直接・間接）を入力してください'
