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
      .from('heater_manufacturing_plans')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('get plans error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (err) {
    console.error('manufacturing plans get error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
