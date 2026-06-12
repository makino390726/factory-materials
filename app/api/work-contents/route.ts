import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('work_contents')
      .select('*')
      .order('work_group_code', { ascending: true })
      .order('work_code', { ascending: true })

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('作業内容取得エラー:', error)
    return NextResponse.json({ error: '作業内容取得に失敗しました' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { work_group_code, work_code, work_name, print_type, rrint_type } = body
    const resolvedPrintType = print_type || rrint_type

    if (!work_group_code || !work_code || !work_name || !resolvedPrintType) {
      return NextResponse.json(
        { error: 'すべての項目は必須です' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('work_contents')
      .select('id')
      .eq('work_group_code', work_group_code)
      .eq('work_code', work_code)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'この作業グループコードと作業コードの組み合わせは既に登録されています' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('work_contents')
      .insert([
        {
          work_group_code,
          work_code,
          work_name,
          print_type: resolvedPrintType,
        },
      ])
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('作業内容登録エラー:', error)
    return NextResponse.json({ error: '作業内容登録に失敗しました' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { id, work_group_code, work_code, work_name, print_type, rrint_type } = body
    const resolvedPrintType = print_type || rrint_type

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    if (!work_group_code || !work_code || !work_name || !resolvedPrintType) {
      return NextResponse.json(
        { error: 'すべての項目は必須です' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('work_contents')
      .select('id')
      .eq('work_group_code', work_group_code)
      .eq('work_code', work_code)
      .neq('id', id)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'この作業グループコードと作業コードの組み合わせは既に登録されています' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('work_contents')
      .update({
        work_group_code,
        work_code,
        work_name,
        print_type: resolvedPrintType,
      })
      .eq('id', id)
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('作業内容更新エラー:', error)
    return NextResponse.json({ error: '作業内容更新に失敗しました' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    const { error } = await supabase.from('work_contents').delete().eq('id', id)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('作業内容削除エラー:', error)
    return NextResponse.json({ error: '作業内容削除に失敗しました' }, { status: 500 })
  }
}
