import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const rawCodes = Array.isArray(body?.codes) ? body.codes : []

    const codes = rawCodes
      .map((code: unknown) => String(code || '').trim())
      .filter((code: string) => code.length > 0)

    if (codes.length === 0) {
      return NextResponse.json({ items: [] })
    }

    const uniqueCodes = Array.from(new Set(codes))

    const { data, error } = await supabase
      .from('products')
      .select('product_code, cost_price')
      .in('product_code', uniqueCodes)

    if (error) {
      console.error('products by-codes fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: data || [] })
  } catch (error) {
    console.error('products by-codes api error:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
