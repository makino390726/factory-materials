import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { calcLaborCostFromMinutes } from '@/lib/line-part-labor-cost'
import {
  listProcessScheduleStSourcesByModel,
  resolveTargetStandardDurationMinutes,
} from '@/lib/process-management'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 品名・コード・部品キーが工費／工賃行かどうかを判定 */
function isLaborFeePartLabel(...labels: Array<string | null | undefined>): boolean {
  const normalized = labels
    .map((v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ''))
    .filter(Boolean)
  if (normalized.length === 0) return false
  return normalized.some(
    (v) =>
      v === '工費' ||
      v === '工賃' ||
      v === 'kouhi' ||
      v === 'labor' ||
      v.includes('工費') ||
      v.includes('工賃')
  )
}

/**
 * GET /api/heater/models/realtime-cost?model=SGR-300
 * 工程管理で当該機種に適用済みの年平均STから、1台あたり工費を算出する（保存はしない）
 */
export async function GET(request: NextRequest) {
  try {
    const model = request.nextUrl.searchParams.get('model')?.trim() || ''
    if (!model) {
      return NextResponse.json({ error: 'model が必要です' }, { status: 400 })
    }

    const sources = await listProcessScheduleStSourcesByModel(supabase, model)
    if (sources.length === 0) {
      return NextResponse.json(
        {
          error: `機種 ${model} に工程管理で適用された年平均STがありません`,
          model,
          st_minutes: 0,
          labor_cost: 0,
          sources: [],
        },
        { status: 404 }
      )
    }

    const resolvedSources: Array<{
      target_type: string
      target_code: string
      fiscal_year: number
      spec_key: string
      minutes: number
      note: string | null
      source: string
    }> = []

    let totalMinutes = 0
    for (const row of sources) {
      const resolved = await resolveTargetStandardDurationMinutes(
        supabase,
        row.target_type,
        row.target_code,
        {
          fiscalYear: row.fiscal_year,
          specKey: row.spec_key,
          model: row.model,
        }
      )
      const minutes = Math.max(0, Number(resolved.minutes || 0))
      if (minutes <= 0) continue
      totalMinutes += minutes
      resolvedSources.push({
        target_type: row.target_type,
        target_code: row.target_code,
        fiscal_year: row.fiscal_year,
        spec_key: row.spec_key,
        minutes,
        note: resolved.note,
        source: resolved.source,
      })
    }

    if (totalMinutes <= 0) {
      return NextResponse.json(
        {
          error: `機種 ${model} の適用STから有効な時間を取得できませんでした`,
          model,
          st_minutes: 0,
          labor_cost: 0,
          sources: resolvedSources,
        },
        { status: 404 }
      )
    }

    const laborCost = calcLaborCostFromMinutes(totalMinutes)

    return NextResponse.json({
      model,
      st_minutes: Math.round(totalMinutes),
      labor_cost: laborCost,
      formula: `(${Math.round(totalMinutes)}分 ÷ 480) × ¥17,810`,
      display_only: true,
      sources: resolvedSources,
    })
  } catch (error) {
    console.error('realtime-cost GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'リアルタイム原価の算出に失敗しました' },
      { status: 500 }
    )
  }
}
