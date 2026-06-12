import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const code = searchParams.get('code')

    if (!category || !code) {
      return NextResponse.json(
        { error: 'category と code が必要です' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('work_report_master_updates')
      .select('*')
      .eq('category', category)
      .eq('code', code)
      .order('from_date', { ascending: false })
      .order('to_date', { ascending: false })

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('加算履歴取得エラー:', error)
    return NextResponse.json({ error: '加算履歴取得に失敗しました' }, { status: 500 })
  }
}
