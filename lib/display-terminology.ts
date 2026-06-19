/** 画面表示用: DBの master_type をラベルに変換 */
export function toDisplayMasterType(masterType: string): string {
  const t = masterType.trim()
  if (t === '指令原価') return 'D指令原価'
  if (t === 'ライン原価') return 'L指令原価'
  return formatUiTerminology(t)
}

/** 画面表示用に「指令」→「D指令」、「ライン」→「L指令」へ変換 */
export function formatUiTerminology(text: string): string {
  if (!text) return text

  const dbLiterals = [
    "'指令原価'",
    '"指令原価"',
    "'ライン原価'",
    '"ライン原価"',
    "'指令全体'",
    '"指令全体"',
    "'指令番号'",
    '"指令番号"',
    "'ラインコード'",
    '"ラインコード"',
    "'ライン名'",
    '"ライン名"',
    "'作業指令番号'",
    '"作業指令番号"',
  ]

  let s = text
  const restored: Array<{ placeholder: string; value: string }> = []
  dbLiterals.forEach((literal, index) => {
    const placeholder = `__DB_LITERAL_${index}__`
    s = s.split(literal).join(placeholder)
    restored.push({ placeholder, value: literal })
  })

  s = s
    .replace(/インライン/g, '__INLINE__')
    .replace(/D指令/g, '__D_ORDER__')
    .replace(/L指令/g, '__L_ORDER__')
    .replace(/作業指令マスタ/g, 'D指令マスタ')
    .replace(/作業指令一覧/g, 'D指令一覧')
    .replace(/作業指令番号/g, 'D指令番号')
    .replace(/作業指令/g, 'D指令')
    .replace(/指令原価/g, 'D指令原価')
    .replace(/指令BOM/g, 'D指令BOM')
    .replace(/指令書/g, 'D指令書')
    .replace(/指令番号/g, 'D指令番号')
    .replace(/指令マスタ/g, 'D指令マスタ')
    .replace(/(?<!D)指令/g, 'D指令')
    .replace(/ラインマスタ/g, 'L指令マスタ')
    .replace(/ライン原価/g, 'L指令原価')
    .replace(/ラインコード/g, 'L指令コード')
    .replace(/ライン名/g, 'L指令名')
    .replace(/(?<!L)ライン/g, 'L指令')
    .replace(/__D_ORDER__/g, 'D指令')
    .replace(/__L_ORDER__/g, 'L指令')
    .replace(/__INLINE__/g, 'インライン')
    .replace(/D{2,}指令/g, 'D指令')

  for (const { placeholder, value } of restored) {
    s = s.split(placeholder).join(value)
  }

  return s
}
