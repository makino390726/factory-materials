import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 製品検索API
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const query = searchParams.get('q')

    if (!query) {
      console.debug('products.search called with empty query')
      return NextResponse.json([])
    }

    const trimmed = query.trim()
    console.debug('products.search called', { query: trimmed })
    // Allow single-character alphanumeric queries for product_code searches,
    // otherwise require at least 2 characters for name searches.
    const isCodeLike = /^[A-Za-z0-9]+$/.test(trimmed)
    if (trimmed.length < 2 && !isCodeLike) {
      return NextResponse.json([])
    }

    const searchTerm = `%${trimmed}%`

    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, name, cost_price')
      .or(`name.ilike.${searchTerm},product_code.ilike.${searchTerm}`)
      .limit(20)
      .order('name', { ascending: true })

    if (error) {
      console.error('検索エラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.debug('products.search result count', { count: (data || []).length })

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('製品検索エラー:', error)
    return NextResponse.json({ error: '検索に失敗しました' }, { status: 500 })
  }
}
