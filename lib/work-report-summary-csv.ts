import { buildCsvRow } from '@/lib/csv-utils'

type SummaryRow = {
  work_date: string
  work_minutes: number
  direct_minutes: number
  indirect_minutes: number
  staff: {
    name: string
    department?: string | null
  }
}

type DailyAggregation = {
  work_date: string
  direct_minutes: number
  indirect_minutes: number
}

type InstructionAggregation = {
  category: 'line' | 'instruction'
  code: string
  name: string
  duration_minutes: number
}

type MachineAggregation = {
  machine: string
  duration_minutes: number
}

type WorkGroupAggregation = {
  work_group_code: string
  work_group_name: string
  total_minutes: number
}

type StaffDetailItem = {
  id: string
  work_content: string
  instruction_text?: string | null
  line_name?: string | null
  model?: string | null
  start_time: string
  end_time: string
  duration_minutes: number
  machine?: string | null
  notes?: string | null
}

type StaffDetail = {
  staff: {
    login_id: string
    name: string
    department?: string | null
    work_group_code?: string | null
  }
  reports: Array<{
    work_date: string
    start_time: string
    end_time: string
    break_minutes: number
    work_minutes: number
    items: StaffDetailItem[]
  }>
}

export type WorkReportSummaryTab =
  | 'summary'
  | 'daily'
  | 'instruction'
  | 'machine'
  | 'work-group'
  | 'person-detail'

type FormatMinutes = (value: number) => string

type GetItemValue = (item: StaffDetailItem, field: keyof StaffDetailItem) => unknown

export function buildWorkReportSummaryCsv(
  tab: WorkReportSummaryTab,
  data: {
    rows: SummaryRow[]
    dailyData: DailyAggregation[]
    instructionData: InstructionAggregation[]
    machineData: MachineAggregation[]
    workGroupData: WorkGroupAggregation[]
    staffDetails: StaffDetail[]
    getItemValue: GetItemValue
    formatMinutes: FormatMinutes
  }
): string {
  const lines: string[] = []

  switch (tab) {
    case 'summary':
      lines.push(buildCsvRow(['日付', '社員', '班', '勤務時間', '直接', '間接']))
      for (const row of data.rows) {
        lines.push(
          buildCsvRow([
            row.work_date,
            row.staff?.name ?? '',
            row.staff?.department || '-',
            data.formatMinutes(row.work_minutes),
            data.formatMinutes(row.direct_minutes || 0),
            data.formatMinutes(row.indirect_minutes || 0),
          ])
        )
      }
      break

    case 'daily':
      lines.push(buildCsvRow(['日付', '直接作業', '間接作業']))
      for (const row of data.dailyData) {
        lines.push(
          buildCsvRow([
            row.work_date,
            data.formatMinutes(row.direct_minutes),
            data.formatMinutes(row.indirect_minutes),
          ])
        )
      }
      break

    case 'instruction':
      lines.push(buildCsvRow(['区分', 'コード', '名称', '所要時間']))
      for (const row of [...data.instructionData].sort((a, b) => {
        if (a.category !== b.category) return a.category === 'line' ? -1 : 1
        return a.code.localeCompare(b.code)
      })) {
        lines.push(
          buildCsvRow([
            row.category === 'line' ? 'L指令' : 'D指令',
            row.code,
            row.name || '-',
            data.formatMinutes(row.duration_minutes),
          ])
        )
      }
      break

    case 'machine':
      lines.push(buildCsvRow(['機械', '仕様時間']))
      for (const row of [...data.machineData].sort(
        (a, b) => b.duration_minutes - a.duration_minutes
      )) {
        lines.push(buildCsvRow([row.machine, data.formatMinutes(row.duration_minutes)]))
      }
      break

    case 'work-group':
      lines.push(buildCsvRow(['作業グループコード', '作業グループ名', '合計時間']))
      for (const row of [...data.workGroupData].sort(
        (a, b) => b.total_minutes - a.total_minutes
      )) {
        lines.push(
          buildCsvRow([
            row.work_group_code,
            row.work_group_name,
            data.formatMinutes(row.total_minutes),
          ])
        )
      }
      break

    case 'person-detail':
      lines.push(
        buildCsvRow([
          '社員名',
          'ログインID',
          '部署',
          '班',
          '日付',
          '勤務開始',
          '勤務終了',
          '休憩(分)',
          '勤務時間',
          '作業内容',
          'D指令',
          'L指令',
          '型式',
          '開始時間',
          '終了時間',
          '所要時間',
          '使用した機械',
          '備考',
        ])
      )
      for (const staff of data.staffDetails) {
        for (const report of staff.reports) {
          if (report.items.length === 0) {
            lines.push(
              buildCsvRow([
                staff.staff.name,
                staff.staff.login_id,
                staff.staff.department || '-',
                staff.staff.work_group_code || '-',
                report.work_date,
                report.start_time,
                report.end_time,
                report.break_minutes,
                data.formatMinutes(report.work_minutes),
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
              ])
            )
            continue
          }
          for (const item of report.items) {
            lines.push(
              buildCsvRow([
                staff.staff.name,
                staff.staff.login_id,
                staff.staff.department || '-',
                staff.staff.work_group_code || '-',
                report.work_date,
                report.start_time,
                report.end_time,
                report.break_minutes,
                data.formatMinutes(report.work_minutes),
                data.getItemValue(item, 'work_content') ?? '',
                data.getItemValue(item, 'instruction_text') ?? item.instruction_text ?? '',
                item.line_name ?? '',
                data.getItemValue(item, 'model') ?? '',
                data.getItemValue(item, 'start_time') ?? '',
                data.getItemValue(item, 'end_time') ?? '',
                data.formatMinutes(Number(data.getItemValue(item, 'duration_minutes') ?? 0)),
                data.getItemValue(item, 'machine') ?? '',
                data.getItemValue(item, 'notes') ?? '',
              ])
            )
          }
        }
      }
      break
  }

  return lines.join('\r\n')
}

const TAB_FILENAME: Record<WorkReportSummaryTab, string> = {
  summary: '人別日別',
  daily: '直接間接日別',
  instruction: '作業指示別',
  machine: '機械仕様時間',
  'work-group': '作業グループ別',
  'person-detail': '人別明細',
}

export function workReportSummaryCsvFilename(
  tab: WorkReportSummaryTab,
  fromDate: string,
  toDate: string
): string {
  return `work-report-${TAB_FILENAME[tab]}-${fromDate}_${toDate}.csv`
}
