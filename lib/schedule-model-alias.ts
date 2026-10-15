/** 製造計画の短い機種コードを、機種マスタ上の型式へ読み替える */
const MODEL_CODE_ALIASES: Record<string, string> = {
  '30A': 'SP-30A',
}

export function canonicalScheduleModel(code: string) {
  const key = String(code || '').trim()
  return MODEL_CODE_ALIASES[key] || key
}

/** 工費の保存先を探す順。30A と SP-30A は同じ機種として、時間がある方を使う */
export function scheduleModelLookupCodes(code: string) {
  const key = String(code || '').trim()
  if (!key) return []
  const codes = [key]
  const canonical = canonicalScheduleModel(key)
  if (canonical !== key) codes.push(canonical)
  for (const [short, full] of Object.entries(MODEL_CODE_ALIASES)) {
    if (key === full && !codes.includes(short)) codes.push(short)
  }
  return codes
}
