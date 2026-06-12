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
      .from('machines')
      .select('*')
      .order('work_group_code', { ascending: true })
      .order('category_code', { ascending: true })

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('機械設備分類取得エラー:', error)
    return NextResponse.json({ error: '機械設備分類取得に失敗しました' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { work_group_code, category_code, category_name } = body

    if (!work_group_code || !category_name) {
      return NextResponse.json(
        { error: '作業グループコードとカテゴリ名は必須です' },
        { status: 400 }
      )
    }

    if (category_code === null || category_code === undefined) {
      return NextResponse.json(
        { error: 'カテゴリコードは必須です' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('machines')
      .select('id')
      .eq('work_group_code', work_group_code)
      .eq('category_code', category_code)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'この作業グループコードとカテゴリコードの組み合わせは既に登録されています' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('machines')
      .insert([
        {
          work_group_code,
          category_code: Number(category_code),
          category_name,
        },
      ])
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('機械設備分類登録エラー:', error)
    return NextResponse.json({ error: '機械設備分類登録に失敗しました' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { id, work_group_code, category_code, category_name } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    if (!work_group_code || !category_name) {
      return NextResponse.json(
        { error: '作業グループコードとカテゴリ名は必須です' },
        { status: 400 }
      )
    }

    if (category_code === null || category_code === undefined) {
      return NextResponse.json(
        { error: 'カテゴリコードは必須です' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('machines')
      .select('id')
      .eq('work_group_code', work_group_code)
      .eq('category_code', category_code)
      .neq('id', id)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'この作業グループコードとカテゴリコードの組み合わせは既に登録されています' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('machines')
      .update({
        work_group_code,
        category_code: Number(category_code),
        category_name,
      })
      .eq('id', id)
      .select()

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('機械設備分類更新エラー:', error)
    return NextResponse.json({ error: '機械設備分類更新に失敗しました' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })
    }

    const { error } = await supabase.from('machines').delete().eq('id', id)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('機械設備分類削除エラー:', error)
    return NextResponse.json({ error: '機械設備分類削除に失敗しました' }, { status: 500 })
  }
}
