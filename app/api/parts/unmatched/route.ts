import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rows = Array.isArray(body.rows) ? body.rows : body.rows ? [body.rows] : []

    if (!rows.length) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    }

    const insertRows = rows.map((r: any) => ({
      product_code: r.product_code?.trim() || null,
      part_key: r.part_key?.trim() || null,
      description: r.description || null,
      source: r.source || null,
    }))

    const { data, error } = await supabase
      .from('unmatched_parts')
      .insert(insertRows)
      .select('id')

    if (error) {
      console.error('Failed insert unmatched_parts:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ inserted: data?.length || 0 })
  } catch (err) {
    console.error('unmatched parts POST error:', err)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
