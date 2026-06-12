/** 作業日報の時間計算（フロント・API共通） */

export const toMinutes = (timeValue: string) => {
  const [hour, minute] = timeValue.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

export const diffMinutes = (start: string, end: string) => {
  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)
  if (startMinutes === null || endMinutes === null) return null
  const diff = endMinutes - startMinutes
  return diff > 0 ? diff : null
}

/** 昼休憩（12:00～13:00）との重複分数 */
export const getLunchBreakOverlap = (start: string, end: string) => {
  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)
  if (startMinutes === null || endMinutes === null) return 0

  const lunchStart = 12 * 60
  const lunchEnd = 13 * 60

  const overlapStart = Math.max(startMinutes, lunchStart)
  const overlapEnd = Math.min(endMinutes, lunchEnd)

  return Math.max(0, overlapEnd - overlapStart)
}

/** 出退社時間から差し引く昼休憩（12:00-13:00との重複のみ。早退で昼前に退社した場合は0） */
export const getEffectiveBreakMinutes = (start: string, end: string) =>
  getLunchBreakOverlap(start, end)

/** 勤務時間（出退社 − 昼休憩重複） */
export const computeWorkMinutes = (start: string, end: string) => {
  const shiftMinutes = diffMinutes(start, end)
  if (!shiftMinutes) return 0
  return Math.max(shiftMinutes - getEffectiveBreakMinutes(start, end), 0)
}

/** 作業明細の所要時間（昼休憩重複を差し引き） */
export const computeItemDurationMinutes = (start: string, end: string) => {
  const duration = diffMinutes(start, end) || 0
  return Math.max(0, duration - getLunchBreakOverlap(start, end))
}
