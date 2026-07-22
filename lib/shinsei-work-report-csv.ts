/** 申請書（製造作業日報）CSV → 作業日報レコードへの変換 */

const SLOT_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'] as const

export type ShinseiParsedItem = {
  slot: number
  work_type: string
  work_content: string
  instruction_text: string | null
  line_code: string | null
  model: string | null
  machine: string | null
  notes: string | null
  start_time: string
  end_time: string
  duration_minutes: number
}

export type ShinseiParsedReport = {
  management_no: string
  login_id: string
  staff_name: string
  work_date: string
  start_time: string
  end_time: string
  break_minutes: number
  work_minutes: number
  work_group_label: string | null
  applied_at: string | null
  items: ShinseiParsedItem[]
  warnings: string[]
}

export type ShinseiParseResult = {
  reports: ShinseiParsedReport[]
  skipped: Array<{ row: number; reason: string }>
  stats: {
    source_rows: number
    report_count: number
    item_count: number
    duplicate_keys_collapsed: number
  }
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (value == null) return ''
  return String(value).replace(/\u3000/g, ' ').trim()
}

function normalizeTime(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function toMinutes(time: string): number | null {
  const m = time.match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function addMinutesToTime(time: string, minutes: number): string | null {
  const base = toMinutes(time)
  if (base === null) return null
  const next = base + minutes
  if (next <= base || next >= 24 * 60) return null
  const h = Math.floor(next / 60)
  const min = next % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function normalizeWorkDate(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null

  // YYYY-MM-DD / YYYY/MM/DD
  const iso = t.replace(/\//g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const y = Number(iso[1])
    const mo = Number(iso[2])
    const d = Number(iso[3])
    if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  // M/D/YY or M/D/YYYY（Excel CSV）
  const mdY = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (mdY) {
    let y = Number(mdY[3])
    if (y < 100) y += 2000
    const mo = Number(mdY[1])
    const d = Number(mdY[2])
    if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  return null
}

function normalizeWorkType(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (t.includes('直接')) return '直接'
  if (t.includes('間接')) return '間接'
  if (t === '直接' || t === '間接') return t
  return null
}

/** D指令番号を抽出（工程管理の照合用に order_no 形式へ） */
export function extractOrderNoFromInstruction(raw: string): string | null {
  const t = raw.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return null

  const patterns = [
    /[DKR]?令\s*(\d{1,4})\s*[-−‐ー－|｜／/]\s*(\d{1,4})/i,
    /\b(\d{1,4})\s*[-−‐ー－]\s*(\d{1,4})\b/,
  ]
  for (const pattern of patterns) {
    const m = t.match(pattern)
    if (m) return `${m[1]}-${m[2]}`
  }

  if (/^\d{1,4}-\d{1,4}/.test(t)) {
    return t.split(/[\s　]/)[0]
  }
  return null
}

export function parseLineCodeFromLabel(raw: string): { line_code: string; model: string | null } | null {
  const t = raw.trim()
  if (!t) return null
  const m = t.match(/^(\d+)\s*[：:]\s*(.*)$/)
  if (m) {
    return {
      line_code: m[1],
      model: m[2].trim() || null,
    }
  }
  if (/^\d+$/.test(t)) {
    return { line_code: t, model: null }
  }
  return null
}

function parsePositiveInt(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const n = Number(t.replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

function buildWorkContent(machine: string, notes: string, model: string, lineLabel: string): string {
  return machine || notes || model || lineLabel || '申請書取込'
}

function parseSlotItem(
  row: Record<string, unknown>,
  slotIndex: number,
  warnings: string[]
): ShinseiParsedItem | null {
  const mark = SLOT_MARKS[slotIndex]
  const durationRaw = cell(row, `所要時間${mark}`)
  const duration = parsePositiveInt(durationRaw)
  if (!duration) return null

  let start = normalizeTime(cell(row, `開始${mark}`))
  let end = normalizeTime(cell(row, `終了${mark}`))

  if (start && end) {
    const sm = toMinutes(start)
    const em = toMinutes(end)
    if (sm !== null && em !== null && em <= sm) {
      const bumped = addMinutesToTime(start, duration)
      if (bumped) {
        end = bumped
        warnings.push(`スロット${mark}: 終了≦開始のため所要時間から終了を補正`)
      } else {
        warnings.push(`スロット${mark}: 開始・終了が不正のためスキップ`)
        return null
      }
    }
  } else if (start && !end) {
    end = addMinutesToTime(start, duration)
    if (!end) {
      warnings.push(`スロット${mark}: 終了時刻を算出できないためスキップ`)
      return null
    }
  } else {
    warnings.push(`スロット${mark}: 開始時刻がないためスキップ`)
    return null
  }

  const workType = normalizeWorkType(cell(row, `作業区分${mark}`)) || '直接'
  const instructionRaw = cell(row, `指令${mark}`)
  const lineRaw = cell(row, `ライン${mark}`)
  const modelRaw = cell(row, `型式${mark}`)
  const machine = cell(row, `機械${mark}`) || null
  const notes = cell(row, `備考${mark}`) || null

  const lineParsed = parseLineCodeFromLabel(lineRaw)
  const orderNo = extractOrderNoFromInstruction(instructionRaw)

  let instruction_text: string | null = null
  let line_code: string | null = null
  let model: string | null = modelRaw || null

  if (lineParsed) {
    line_code = lineParsed.line_code
    if (!model && lineParsed.model) model = lineParsed.model
  }
  if (orderNo) {
    instruction_text = orderNo
  } else if (instructionRaw && !line_code) {
    instruction_text = instructionRaw.slice(0, 120)
    warnings.push(`スロット${mark}: 指令番号を抽出できず原文を保存 (${instructionRaw.slice(0, 40)})`)
  }

  // 直接作業で指令もラインも無い場合は警告のみ（間接は許容）
  if (workType === '直接' && !instruction_text && !line_code) {
    warnings.push(`スロット${mark}: 直接作業だがD指令・L指令が空`)
  }

  return {
    slot: slotIndex + 1,
    work_type: workType,
    work_content: buildWorkContent(machine || '', notes || '', model || '', lineRaw),
    instruction_text,
    line_code,
    model,
    machine,
    notes,
    start_time: start,
    end_time: end,
    duration_minutes: duration,
  }
}

function parseReportRow(
  row: Record<string, unknown>,
  rowNumber: number
): { report: ShinseiParsedReport } | { skip: string } {
  const loginId = cell(row, '社員名（コード）') || cell(row, '申請者（コード）')
  if (!loginId) return { skip: `行${rowNumber}: 社員コードが空` }

  const workDate = normalizeWorkDate(cell(row, '日時'))
  if (!workDate) return { skip: `行${rowNumber}: 日時が不正` }

  const startTime = normalizeTime(cell(row, '出社'))
  const endTime = normalizeTime(cell(row, '退社'))
  if (!startTime || !endTime) return { skip: `行${rowNumber}: 出社/退社が不正` }

  const startMin = toMinutes(startTime)
  const endMin = toMinutes(endTime)
  if (startMin === null || endMin === null || endMin <= startMin) {
    return { skip: `行${rowNumber}: 出退社の大小関係が不正` }
  }

  const warnings: string[] = []
  const items: ShinseiParsedItem[] = []
  for (let i = 0; i < SLOT_MARKS.length; i++) {
    const item = parseSlotItem(row, i, warnings)
    if (item) items.push(item)
  }
  if (items.length === 0) return { skip: `行${rowNumber}: 有効な作業明細がない` }

  const shiftMinutes = endMin - startMin
  const workMinutesRaw = parsePositiveInt(cell(row, '勤務時間'))
  const itemsTotal = items.reduce((sum, item) => sum + item.duration_minutes, 0)
  const workMinutes = workMinutesRaw || itemsTotal
  if (workMinutes <= 0) return { skip: `行${rowNumber}: 勤務時間が0` }

  let breakMinutes = shiftMinutes - workMinutes
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) breakMinutes = 0
  // 昼休憩想定の上限ガード
  if (breakMinutes > 180) {
    warnings.push(`休憩 ${breakMinutes}分が長いため 60分に補正`)
    breakMinutes = 60
  }

  return {
    report: {
      management_no: cell(row, '管理番号'),
      login_id: loginId,
      staff_name: cell(row, '社員名') || cell(row, '申請者'),
      work_date: workDate,
      start_time: startTime,
      end_time: endTime,
      break_minutes: breakMinutes,
      work_minutes: workMinutes,
      work_group_label: cell(row, '作業班') || null,
      applied_at: cell(row, '申請日時') || null,
      items,
      warnings,
    },
  }
}

/**
 * 申請書CSVの行配列（ヘッダーキー付きオブジェクト）を日報単位に変換。
 * 同一 社員コード+作業日 は申請日時が新しい行で上書き（CSV内重複つぶし）。
 */
export function parseShinseiWorkReportRows(rows: Record<string, unknown>[]): ShinseiParseResult {
  const byKey = new Map<string, ShinseiParsedReport>()
  const skipped: Array<{ row: number; reason: string }> = []
  let duplicateKeysCollapsed = 0

  rows.forEach((row, index) => {
    const rowNumber = index + 2 // header = 1
    const parsed = parseReportRow(row, rowNumber)
    if ('skip' in parsed) {
      skipped.push({ row: rowNumber, reason: parsed.skip })
      return
    }
    const key = `${parsed.report.login_id}__${parsed.report.work_date}`
    if (byKey.has(key)) {
      duplicateKeysCollapsed += 1
      const prev = byKey.get(key)!
      // 申請日時が分かる場合は新しい方を残す
      if ((parsed.report.applied_at || '') >= (prev.applied_at || '')) {
        byKey.set(key, parsed.report)
      }
    } else {
      byKey.set(key, parsed.report)
    }
  })

  const reports = Array.from(byKey.values()).sort((a, b) => {
    const byDate = a.work_date.localeCompare(b.work_date)
    if (byDate !== 0) return byDate
    return a.login_id.localeCompare(b.login_id, 'ja', { numeric: true })
  })

  return {
    reports,
    skipped,
    stats: {
      source_rows: rows.length,
      report_count: reports.length,
      item_count: reports.reduce((sum, r) => sum + r.items.length, 0),
      duplicate_keys_collapsed: duplicateKeysCollapsed,
    },
  }
}
