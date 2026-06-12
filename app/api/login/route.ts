import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { login_id?: string }
    const loginId = body.login_id?.trim()

    if (!loginId) {
      return NextResponse.json(
        { success: false, error: 'ログインIDを入力してください' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('staffs')
      .select('id, login_id, name, department, work_group_code')
      .eq('login_id', loginId)
      .maybeSingle()

    if (error) {
      console.error('スタッフ取得エラー:', error)
      return NextResponse.json(
        { success: false, error: 'ログイン情報の取得に失敗しました' },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'ログインIDが見つかりません' },
        { status: 401 }
      )
    }

    return NextResponse.json({ success: true, staff: data })
  } catch (error) {
    console.error('ログインAPIエラー:', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
