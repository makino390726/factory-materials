import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseShinseiWorkReportRows,
  type ShinseiParsedReport,
  type ShinseiParseResult,
} from '@/lib/shinsei-work-report-csv'
import {
  parseYearMonthFromDate,
  syncMonthForTouchedCodes,
} from '@/lib/work-report-monthly-sync'

export type ShinseiImportSummary = {
  parse: ShinseiParseResult['stats'] & { skipped_count: number }
  imported: number
  overwritten: number
  created: number
  failed: Array<{ login_id: string; work_date: string; error: string }>
  missing_staff: string[]
  name_matched_staff: string[]
  missing_lines: string[]
  warnings: string[]
  months_synced: string[]
}

type StaffRow = {
  id: string
  login_id: string
  name: string | null
  work_group_code: string | null
}

function normalizePersonName(name: string) {
  return name
    .replace(/\s+/g, '')
    .replace(/　/g, '')
    .replace(/[濵濱]/g, '浜')
    .replace(/[﨑崎]/g, '崎')
    .replace(/[髙]/g, '高')
    .replace(/[福]/g, '福')
    .replace(/[邉邊]/g, '辺')
    .replace(/[敎]/g, '教')
    .replace(/[瀨]/g, '瀬')
}

function mapWorkGroupLabelToCode(
  label: string | null | undefined,
  groups: Array<{ work_group_code: string; work_name: string }>
): string | null {
  if (!label) return null
  const normalized = label.replace(/\s+/g, '').replace(/[－−]/g, '-')
  for (const group of groups) {
    const name = (group.work_name || '').replace(/\s+/g, '')
    if (name && (normalized.includes(name) || name.includes(normalized))) {
      return group.work_group_code
    }
    // （A-1）のようなコード断片
    const m = normalized.match(/[（(]([A-Za-z0-9\-]+)[）)]/)
    if (m && group.work_group_code.replace(/\s+/g, '') === m[1]) {
      return group.work_group_code
    }
  }
  return null
}

async function upsertOneReport(
  supabase: SupabaseClient,
  report: ShinseiParsedReport,
  staffId: string,
  staffWorkGroup: string | null,
  lineIdByCode: Map<string, string>,
  workGroups: Array<{ work_group_code: string; work_name: string }>
): Promise<{ overwritten: boolean; touchedLines: string[]; touchedInstructions: string[] }> {
  const touchedLines: string[] = []
  const touchedInstructions: string[] = []

  const supportGroup = mapWorkGroupLabelToCode(report.work_group_label, workGroups)
  const isSupport = Boolean(
    supportGroup && staffWorkGroup && supportGroup !== staffWorkGroup
  )

  const itemsPayload = report.items.map((item) => {
    const lineId = item.line_code ? lineIdByCode.get(item.line_code) || null : null
    if (item.line_code) {
      if (lineId) touchedLines.push(item.line_code)
    }
    if (item.instruction_text) touchedInstructions.push(item.instruction_text)

    return {
      is_support: isSupport,
      support_work_group_code: isSupport ? supportGroup : null,
      work_type: item.work_type,
      work_content: item.work_content,
      instruction_text: item.instruction_text,
      line_id: lineId,
      model: item.model,
      machine: item.machine,
      notes: item.notes,
      start_time: item.start_time,
      end_time: item.end_time,
      duration_minutes: item.duration_minutes,
    }
  })

  const { data: existing, error: findError } = await supabase
    .from('work_reports')
    .select('id')
    .eq('staff_id', staffId)
    .eq('work_date', report.work_date)
    .maybeSingle()

  if (findError) throw findError

  const header = {
    staff_id: staffId,
    work_date: report.work_date,
    start_time: report.start_time,
    end_time: report.end_time,
    break_minutes: report.break_minutes,
    work_minutes: report.work_minutes,
    is_draft: false,
    updated_at: new Date().toISOString(),
  }

  let reportId: string
  let overwritten = false

  if (existing?.id) {
    overwritten = true
    reportId = existing.id
    const { error: updateError } = await supabase
      .from('work_reports')
      .update(header)
      .eq('id', reportId)
    if (updateError) throw updateError

    const { error: deleteError } = await supabase
      .from('work_report_items')
      .delete()
      .eq('report_id', reportId)
    if (deleteError) throw deleteError
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('work_reports')
      .insert(header)
      .select('id')
      .single()
    if (insertError) throw insertError
    reportId = inserted.id as string
  }

  const { error: itemsError } = await supabase.from('work_report_items').insert(
    itemsPayload.map((item) => ({
      ...item,
      report_id: reportId,
    }))
  )
  if (itemsError) throw itemsError

  return { overwritten, touchedLines, touchedInstructions }
}

export async function importShinseiWorkReports(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
  options?: { syncMonthly?: boolean }
): Promise<ShinseiImportSummary> {
  const parsed = parseShinseiWorkReportRows(rows)
  const warnings = [
    ...parsed.skipped.slice(0, 30).map((s) => s.reason),
    ...parsed.reports.flatMap((r) =>
      r.warnings.slice(0, 3).map((w) => `${r.login_id} ${r.work_date}: ${w}`)
    ),
  ]

  const { data: staffs, error: staffError } = await supabase
    .from('staffs')
    .select('id, login_id, name, work_group_code')
  if (staffError) throw staffError

  const staffRows = (staffs || []) as StaffRow[]
  const staffByLogin = new Map(staffRows.map((s) => [String(s.login_id).trim(), s] as const))
  const staffByName = new Map<string, StaffRow[]>()
  for (const s of staffRows) {
    const name = normalizePersonName(String(s.name || ''))
    if (!name) continue
    const list = staffByName.get(name) || []
    list.push(s)
    staffByName.set(name, list)
  }

  const { data: lines, error: lineError } = await supabase
    .from('lines')
    .select('id, line_code')
  if (lineError) throw lineError
  const lineIdByCode = new Map(
    (lines || []).map((l) => [String(l.line_code).trim(), l.id as string] as const)
  )

  const { data: workGroups, error: wgError } = await supabase
    .from('work_group_master')
    .select('work_group_code, work_name')
  if (wgError) throw wgError

  const missingStaff = new Set<string>()
  const nameMatchedStaff = new Set<string>()
  const missingLines = new Set<string>()
  const failed: ShinseiImportSummary['failed'] = []
  let imported = 0
  let overwritten = 0
  let created = 0

  const touchedByMonth = new Map<string, { lines: Set<string>; instructions: Set<string> }>()

  for (const report of parsed.reports) {
    let staff = staffByLogin.get(report.login_id) || null
    let matchedBy: 'login_id' | 'name' | 'none' | 'ambiguous_name' = staff ? 'login_id' : 'none'
    if (!staff) {
      const nameKey = normalizePersonName(report.staff_name || '')
      const candidates = nameKey ? staffByName.get(nameKey) : undefined
      if (candidates && candidates.length === 1) {
        staff = candidates[0]
        matchedBy = 'name'
      } else if (candidates && candidates.length > 1) {
        matchedBy = 'ambiguous_name'
      }
    }

    if (!staff) {
      missingStaff.add(`${report.login_id}:${report.staff_name || '?'}`)
      failed.push({
        login_id: report.login_id,
        work_date: report.work_date,
        error:
          matchedBy === 'ambiguous_name'
            ? `社員名「${report.staff_name}」が複数ヒット`
            : `社員マスタに login_id=${report.login_id} / 氏名=${report.staff_name} がありません`,
      })
      continue
    }
    if (matchedBy === 'name') {
      nameMatchedStaff.add(`${report.login_id}->${staff.login_id}(${report.staff_name})`)
    }

    for (const item of report.items) {
      if (item.line_code && !lineIdByCode.has(item.line_code)) {
        missingLines.add(item.line_code)
      }
    }

    try {
      const result = await upsertOneReport(
        supabase,
        report,
        staff.id,
        staff.work_group_code || null,
        lineIdByCode,
        workGroups || []
      )
      imported += 1
      if (result.overwritten) overwritten += 1
      else created += 1

      const ym = parseYearMonthFromDate(report.work_date)
      if (ym) {
        const key = `${ym.year}-${String(ym.month).padStart(2, '0')}`
        const bucket = touchedByMonth.get(key) || {
          lines: new Set<string>(),
          instructions: new Set<string>(),
        }
        for (const code of result.touchedLines) bucket.lines.add(code)
        for (const code of result.touchedInstructions) bucket.instructions.add(code)
        touchedByMonth.set(key, bucket)
      }
    } catch (error) {
      failed.push({
        login_id: report.login_id,
        work_date: report.work_date,
        error: error instanceof Error ? error.message : '取込失敗',
      })
    }
  }

  const monthsSynced: string[] = []
  if (options?.syncMonthly !== false) {
    for (const [monthKey, bucket] of touchedByMonth) {
      const [yearStr, monthStr] = monthKey.split('-')
      const year = Number(yearStr)
      const month = Number(monthStr)
      try {
        await syncMonthForTouchedCodes(
          supabase,
          year,
          month,
          bucket.lines,
          bucket.instructions
        )
        monthsSynced.push(monthKey)
      } catch (error) {
        warnings.push(
          `月次同期失敗 ${monthKey}: ${error instanceof Error ? error.message : 'unknown'}`
        )
      }
    }
  }

  return {
    parse: {
      ...parsed.stats,
      skipped_count: parsed.skipped.length,
    },
    imported,
    overwritten,
    created,
    failed: failed.slice(0, 50),
    missing_staff: Array.from(missingStaff).sort(),
    name_matched_staff: Array.from(nameMatchedStaff).sort(),
    missing_lines: Array.from(missingLines).sort(),
    warnings: warnings.slice(0, 80),
    months_synced: monthsSynced,
  }
}
