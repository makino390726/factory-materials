import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseStandardDuration(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const lineCode = searchParams.get('lineCode')?.trim()
    const lineName = searchParams.get('lineName')?.trim()

    let query = supabase.from('lines').select('*')

    if (lineCode) {
      query = query.ilike('line_code', `%${lineCode}%`)
    }

    if (lineName) {
      query = query.ilike('name', `%${lineName}%`)
    }

    const { data, error } = await query
      .order('sort_order', { ascending: true })
      .order('line_code', { ascending: true })

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 各ラインの割り当てを取得
    const lines = data || []
    const enriched = await Promise.all(
      lines.map(async (line: any) => {
        const { data: assignments, error: assignError } = await supabase
          .from('line_part_assignments')
          .select('*')
          .eq('line_id', line.id)
        
        if (assignError) {
          console.error(`割り当て取得エラー (line_id=${line.id}):`, assignError)
        }
        
        return {
          ...line,
          part_assignments: assignments || []
        }
      })
    )

    return NextResponse.json(enriched)
  } catch (error) {
    console.error('ライン取得エラー:', error)
    return NextResponse.json({ error: 'ライン取得に失敗しました' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { line_code, name, sort_order, is_active, part_key, standard_duration_minutes } = body

    if (!line_code || !name) {
      return NextResponse.json(
        { error: 'ラインコードとライン名は必須です' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('lines')
      .select('id')
      .eq('line_code', line_code)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'このラインコードは既に登録されています' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('lines')
      .insert([
        {
          line_code,
          name,
          sort_order: typeof sort_order === 'number' ? sort_order : 0,
          is_active: typeof is_active === 'boolean' ? is_active : true,
          part_key: part_key || null,
          standard_duration_minutes: parseStandardDuration(standard_duration_minutes),
        },
      ])
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('ライン登録エラー:', error)
    return NextResponse.json({ error: 'ライン登録に失敗しました' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { id, line_code, name, sort_order, is_active, part_key, standard_duration_minutes } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    if (!line_code || !name) {
      return NextResponse.json(
        { error: 'ラインコードとライン名は必須です' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('lines')
      .select('id')
      .eq('line_code', line_code)
      .neq('id', id)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'このラインコードは既に登録されています' },
        { status: 400 }
      )
    }

    const updatePayload: Record<string, unknown> = {
      line_code,
      name,
      sort_order: typeof sort_order === 'number' ? sort_order : 0,
      is_active: typeof is_active === 'boolean' ? is_active : true,
      part_key: part_key || null,
    }
    if (standard_duration_minutes !== undefined) {
      updatePayload.standard_duration_minutes = parseStandardDuration(standard_duration_minutes)
    }

    const { data, error } = await supabase
      .from('lines')
      .update(updatePayload)
      .eq('id', id)
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('ライン更新エラー:', error)
    return NextResponse.json({ error: 'ライン更新に失敗しました' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    const { error } = await supabase.from('lines').delete().eq('id', id)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('ライン削除エラー:', error)
    return NextResponse.json({ error: 'ライン削除に失敗しました' }, { status: 500 })
  }
}
