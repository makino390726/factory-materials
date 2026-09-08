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
    const isCodeLike = /^[A-Za-z0-9]+$/.test(trimmed)
    if (trimmed.length < 2 && !isCodeLike) {
      return NextResponse.json([])
    }

    const safe = trimmed.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim()
    const tokens = safe.split(' ').filter((t) => t.length >= 1).slice(0, 6)
    const orNameCode = tokens
      .flatMap((t) => [`name.ilike.%${t}%`, `product_code.ilike.%${t}%`])
      .join(',')
    const orWithSpec = tokens
      .flatMap((t) => [`name.ilike.%${t}%`, `spec.ilike.%${t}%`, `product_code.ilike.%${t}%`])
      .join(',')

    const trySelect = async (select: string, filter: string) =>
      supabase.from('products').select(select).or(filter).limit(60).order('name', { ascending: true })

    type ProductHit = {
      id?: string
      product_code?: string
      name?: string
      spec?: string | null
      cost_price?: number | null
    }
    const first = await trySelect('id, product_code, name, spec, cost_price', orWithSpec)
    let data: ProductHit[] = []
    let error = first.error
    if (!error) {
      data = (first.data ?? []) as unknown as ProductHit[]
    } else {
      const fallback = await trySelect('id, product_code, name, cost_price', orNameCode)
      error = fallback.error
      data = ((fallback.data ?? []) as unknown as ProductHit[]).map((r) => ({ ...r, spec: null }))
    }

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
