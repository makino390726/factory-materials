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
      .from('staffs')
      .select('*')
      .order('login_id', { ascending: true })

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('スタッフ取得エラー:', error)
    return NextResponse.json({ error: 'スタッフ取得に失敗しました' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { login_id, name, department, work_group_code } = body

    if (!login_id || !name) {
      return NextResponse.json(
        { error: 'ログインIDと氏名は必須です' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('staffs')
      .select('id')
      .eq('login_id', login_id)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'このログインIDは既に登録されています' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('staffs')
      .insert([
        {
          login_id,
          name,
          department: department || null,
          work_group_code: work_group_code || null,
        },
      ])
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('スタッフ登録エラー:', error)
    return NextResponse.json({ error: 'スタッフ登録に失敗しました' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { id, login_id, name, department, work_group_code } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    if (!login_id || !name) {
      return NextResponse.json(
        { error: 'ログインIDと氏名は必須です' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('staffs')
      .select('id')
      .eq('login_id', login_id)
      .neq('id', id)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'このログインIDは既に登録されています' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('staffs')
      .update({
        login_id,
        name,
        department: department || null,
        work_group_code: work_group_code || null,
      })
      .eq('id', id)
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('スタッフ更新エラー:', error)
    return NextResponse.json({ error: 'スタッフ更新に失敗しました' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    const { error } = await supabase.from('staffs').delete().eq('id', id)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('スタッフ削除エラー:', error)
    return NextResponse.json({ error: 'スタッフ削除に失敗しました' }, { status: 500 })
  }
}
