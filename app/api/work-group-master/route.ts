import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - 作業グループマスター一覧取得
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('work_group_master')
      .select('*')
      .order('group_no')
      .order('work_group_code')

    if (error) throw error

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('作業グループマスター取得エラー:', error)
    return NextResponse.json(
      { error: '作業グループマスターの取得に失敗しました' },
      { status: 500 }
    )
  }
}

// POST - 作業グループマスター新規登録
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { group_no, work_group_code, work_name } = body

    if (!group_no?.trim() || !work_group_code?.trim() || !work_name?.trim()) {
      return NextResponse.json(
        { error: 'すべての項目を入力してください' },
        { status: 400 }
      )
    }

    // 重複チェック
    const { data: existing } = await supabase
      .from('work_group_master')
      .select('id')
      .eq('work_group_code', work_group_code.trim())
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'この作業グループコードは既に登録されています' },
        { status: 409 }
      )
    }

    // 新規登録
    const { data, error } = await supabase
      .from('work_group_master')
      .insert({
        group_no: group_no.trim(),
        work_group_code: work_group_code.trim(),
        work_name: work_name.trim(),
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('作業グループマスター登録エラー:', error)
    return NextResponse.json(
      { error: '作業グループマスターの登録に失敗しました' },
      { status: 500 }
    )
  }
}

// PUT - 作業グループマスター更新
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, group_no, work_group_code, work_name } = body

    if (!id) {
      return NextResponse.json({ error: 'IDが指定されていません' }, { status: 400 })
    }

    if (!group_no?.trim() || !work_group_code?.trim() || !work_name?.trim()) {
      return NextResponse.json(
        { error: 'すべての項目を入力してください' },
        { status: 400 }
      )
    }

    // 重複チェック（自分以外）
    const { data: existing } = await supabase
      .from('work_group_master')
      .select('id')
      .eq('work_group_code', work_group_code.trim())
      .neq('id', id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'この作業グループコードは既に登録されています' },
        { status: 409 }
      )
    }

    // 更新
    const { data, error } = await supabase
      .from('work_group_master')
      .update({
        group_no: group_no.trim(),
        work_group_code: work_group_code.trim(),
        work_name: work_name.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error) {
    console.error('作業グループマスター更新エラー:', error)
    return NextResponse.json(
      { error: '作業グループマスターの更新に失敗しました' },
      { status: 500 }
    )
  }
}

// DELETE - 作業グループマスター削除
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'IDが指定されていません' }, { status: 400 })
    }

    const { error } = await supabase.from('work_group_master').delete().eq('id', id)

    if (error) throw error

    return NextResponse.json({ message: '削除しました' })
  } catch (error) {
    console.error('作業グループマスター削除エラー:', error)
    return NextResponse.json(
      { error: '作業グループマスターの削除に失敗しました' },
      { status: 500 }
    )
  }
}
