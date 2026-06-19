import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  computeItemDurationMinutes,
  computeWorkMinutes,
  diffMinutes,
  getEffectiveBreakMinutes,
  toMinutes,
} from '@/lib/work-report-time'
import {
  hasWorkTarget,
  WORK_TARGET_VALIDATION_MESSAGE,
} from '@/lib/work-report-item-validation'
import { parseYearMonthFromDate, syncMonthFromWorkReports } from '@/lib/work-report-monthly-sync'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type WorkItemInput = {
  is_support?: boolean
  support_work_group_code?: string | null
  work_type?: string
  work_content?: string
  instruction_text?: string
  line_id?: string | null
  model?: string
  machine?: string
  notes?: string
  start_time?: string
  end_time?: string
}

type MachineTimeConfirmationInput = {
  machine?: string
  computed_duration_minutes?: number
  confirmed_duration_minutes?: number
}

type WorkReportInput = {
  staff_id?: string
  work_date?: string
  start_time?: string
  end_time?: string
  break_minutes?: number
  is_draft?: boolean
  items?: WorkItemInput[]
  machine_time_confirmations?: MachineTimeConfirmationInput[]
}

function aggregateMachineMinutesFromNormalizedItems(
  items: Array<{ machine?: unknown; duration_minutes?: unknown }>
) {
  const map = new Map<string, number>()
  for (const item of items) {
    const name =
      typeof item.machine === 'string' && item.machine.trim() ? item.machine.trim() : ''
    if (!name) continue
    const duration =
      typeof item.duration_minutes === 'number' && Number.isFinite(item.duration_minutes)
        ? item.duration_minutes
        : 0
    map.set(name, (map.get(name) || 0) + duration)
  }
  return map
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const staffId = searchParams.get('staff_id')
    const workDate = searchParams.get('work_date')

    if (!staffId || !workDate) {
      return NextResponse.json(
        { error: 'staff_id と work_date が必要です' },
        { status: 400 }
      )
    }

    const { data: report, error } = await supabase
      .from('work_reports')
      .select('*')
      .eq('staff_id', staffId)
      .eq('work_date', workDate)
      .maybeSingle()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!report) {
      return NextResponse.json({ error: 'データが見つかりません' }, { status: 404 })
    }

    const { data: items, error: itemError } = await supabase
      .from('work_report_items')
      .select('*')
      .eq('report_id', report.id)
      .order('start_time', { ascending: true })

    if (itemError) {
      console.error('Supabaseエラー:', itemError)
      return NextResponse.json({ error: itemError.message }, { status: 500 })
    }

    const { data: machineDurations, error: mdError } = await supabase
      .from('work_report_machine_durations')
      .select('machine, computed_duration_minutes, confirmed_duration_minutes')
      .eq('report_id', report.id)
      .order('machine', { ascending: true })

    if (mdError) {
      console.error('Supabaseエラー:', mdError)
      return NextResponse.json({ error: mdError.message }, { status: 500 })
    }

    return NextResponse.json({
      report,
      items: items || [],
      machine_durations: machineDurations || [],
    })
  } catch (error) {
    console.error('作業日報取得エラー:', error)
    return NextResponse.json({ error: '作業日報取得に失敗しました' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as WorkReportInput
    const staffId = body.staff_id
    const workDate = body.work_date
    const startTime = typeof body.start_time === 'string' && body.start_time.trim() ? body.start_time : null
    const endTime = typeof body.end_time === 'string' && body.end_time.trim() ? body.end_time : null
    const breakMinutesOverride =
      typeof body.break_minutes === 'number' ? body.break_minutes : null
    const isDraft = body.is_draft === true
    const items = body.items || []
    const machineTimeConfirmations = body.machine_time_confirmations

    if (!staffId || !workDate) {
      return NextResponse.json(
        { error: 'staff_id, work_date は必須です' },
        { status: 400 }
      )
    }

    if (!isDraft && (!startTime || !endTime)) {
      return NextResponse.json(
        { error: 'start_time, end_time は必須です' },
        { status: 400 }
      )
    }

    let workMinutes: number | null = null
    let storedBreakMinutes = breakMinutesOverride ?? 60
    let reportStartMinutes: number | null = null
    let reportEndMinutes: number | null = null

    if (startTime && endTime) {
      if (!diffMinutes(startTime, endTime)) {
        return NextResponse.json({ error: '出社・退社時間を確認してください' }, { status: 400 })
      }

      storedBreakMinutes =
        breakMinutesOverride ?? getEffectiveBreakMinutes(startTime, endTime)
      workMinutes = computeWorkMinutes(startTime, endTime)
      if (workMinutes <= 0) {
        return NextResponse.json({ error: '勤務時間が0以下です' }, { status: 400 })
      }

      reportStartMinutes = toMinutes(startTime)
      reportEndMinutes = toMinutes(endTime)
      if (reportStartMinutes === null || reportEndMinutes === null) {
        return NextResponse.json({ error: '時間形式が不正です' }, { status: 400 })
      }
    }

    let totalItemMinutes = 0
    const normalizedItems = items.reduce<Array<Record<string, unknown>>>((acc, item) => {
      const hasRequiredFields = Boolean(
        item.work_type && item.start_time && item.end_time
      )

      if (!hasRequiredFields) {
        if (isDraft) return acc
        throw new Error('作業区分・開始/終了時間は必須です')
      }

      if (!hasWorkTarget(item)) {
        throw new Error(WORK_TARGET_VALIDATION_MESSAGE)
      }

      const rawDuration = diffMinutes(item.start_time!, item.end_time!)
      if (!rawDuration) {
        throw new Error('作業明細の時間を確認してください')
      }

      const itemStart = toMinutes(item.start_time!)
      const itemEnd = toMinutes(item.end_time!)
      if (itemStart === null || itemEnd === null) {
        throw new Error('作業明細の時間形式が不正です')
      }

      if (
        reportStartMinutes !== null &&
        reportEndMinutes !== null &&
        (itemStart < reportStartMinutes || itemEnd > reportEndMinutes)
      ) {
        throw new Error('作業時間が出退社時間の範囲外です')
      }

      const duration = computeItemDurationMinutes(item.start_time!, item.end_time!)

      totalItemMinutes += duration

      acc.push({
        is_support: item.is_support || false,
        support_work_group_code: item.support_work_group_code || null,
        work_type: item.work_type,
        work_content: item.work_content,
        instruction_text: item.instruction_text || null,
        line_id: item.line_id || null,
        model: item.model || null,
        machine: item.machine || null,
        notes: item.notes || null,
        start_time: item.start_time,
        end_time: item.end_time,
        duration_minutes: duration,
      })

      return acc
    }, [])

    if (!isDraft && normalizedItems.length === 0) {
      return NextResponse.json({ error: '作業明細を追加してください' }, { status: 400 })
    }

    if (!isDraft && workMinutes !== null && totalItemMinutes !== workMinutes) {
      return NextResponse.json(
        { error: '所要時間の合計と勤務時間が一致していません' },
        { status: 400 }
      )
    }

    const { data: existingReport, error: findError } = await supabase
      .from('work_reports')
      .select('id')
      .eq('staff_id', staffId)
      .eq('work_date', workDate)
      .maybeSingle()

    if (findError) {
      console.error('Supabaseエラー:', findError)
      return NextResponse.json({ error: findError.message }, { status: 500 })
    }

    let reportId = existingReport?.id
    if (reportId) {
      const { error: updateError } = await supabase
        .from('work_reports')
        .update({
          start_time: startTime,
          end_time: endTime,
          break_minutes: storedBreakMinutes,
          work_minutes: workMinutes,
          is_draft: isDraft,
        })
        .eq('id', reportId)

      if (updateError) {
        console.error('Supabaseエラー:', updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      const { error: deleteError } = await supabase
        .from('work_report_items')
        .delete()
        .eq('report_id', reportId)

      if (deleteError) {
        console.error('Supabaseエラー:', deleteError)
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
      }
    } else {
      const { data: report, error: insertError } = await supabase
        .from('work_reports')
        .insert([
          {
            staff_id: staffId,
            work_date: workDate,
            start_time: startTime,
            end_time: endTime,
            break_minutes: storedBreakMinutes,
            work_minutes: workMinutes,
            is_draft: isDraft,
          },
        ])
        .select()
        .single()

      if (insertError) {
        console.error('Supabaseエラー:', insertError)
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }

      reportId = report.id
    }

    if (normalizedItems.length > 0) {
      const { error: itemInsertError } = await supabase
        .from('work_report_items')
        .insert(
          normalizedItems.map((item) => ({
            report_id: reportId,
            ...item,
          }))
        )

      if (itemInsertError) {
        console.error('Supabaseエラー:', itemInsertError)
        return NextResponse.json({ error: itemInsertError.message }, { status: 500 })
      }
    }

    const { error: deleteMdError } = await supabase
      .from('work_report_machine_durations')
      .delete()
      .eq('report_id', reportId)

    if (deleteMdError) {
      console.error('Supabaseエラー:', deleteMdError)
      return NextResponse.json({ error: deleteMdError.message }, { status: 500 })
    }

    if (!isDraft && normalizedItems.length > 0) {
      const machineMap = aggregateMachineMinutesFromNormalizedItems(normalizedItems)
      if (machineMap.size > 0) {
        const rows: Array<{
          report_id: string
          machine: string
          computed_duration_minutes: number
          confirmed_duration_minutes: number
        }> = []

        if (Array.isArray(machineTimeConfirmations) && machineTimeConfirmations.length > 0) {
          const byMachine = new Map<string, MachineTimeConfirmationInput>()
          for (const c of machineTimeConfirmations) {
            const name =
              typeof c.machine === 'string' && c.machine.trim() ? c.machine.trim() : ''
            if (!name) {
              throw new Error('機械稼働時間の機械名が不正です')
            }
            byMachine.set(name, c)
          }
          for (const name of byMachine.keys()) {
            if (!machineMap.has(name)) {
              throw new Error(`明細にない機械「${name}」の確定時間が含まれています`)
            }
          }
          for (const machine of machineMap.keys()) {
            const c = byMachine.get(machine)
            if (!c) {
              throw new Error(`機械「${machine}」の確定時間がありません`)
            }
            const confirmedRaw = c.confirmed_duration_minutes
            const confirmed =
              typeof confirmedRaw === 'number' && Number.isFinite(confirmedRaw)
                ? Math.max(0, Math.floor(confirmedRaw))
                : null
            if (confirmed === null) {
              throw new Error(`機械「${machine}」の確定時間が不正です`)
            }
            rows.push({
              report_id: reportId!,
              machine,
              computed_duration_minutes: machineMap.get(machine) || 0,
              confirmed_duration_minutes: confirmed,
            })
          }
        } else {
          for (const [machine, computed] of machineMap.entries()) {
            rows.push({
              report_id: reportId!,
              machine,
              computed_duration_minutes: computed,
              confirmed_duration_minutes: computed,
            })
          }
        }

        const { error: mdInsertError } = await supabase
          .from('work_report_machine_durations')
          .insert(rows)

        if (mdInsertError) {
          console.error('Supabaseエラー:', mdInsertError)
          return NextResponse.json({ error: mdInsertError.message }, { status: 500 })
        }
      }
    }

    if (!isDraft && workDate) {
      const yearMonth = parseYearMonthFromDate(workDate)
      if (yearMonth) {
        try {
          await syncMonthFromWorkReports(supabase, yearMonth.year, yearMonth.month)
        } catch (syncErr) {
          console.error('月別実績の同期エラー:', syncErr)
        }
      }
    }

    return NextResponse.json({ success: true, report_id: reportId })
  } catch (error) {
    const message = error instanceof Error ? error.message : '作業日報登録に失敗しました'
    console.error('作業日報登録エラー:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
