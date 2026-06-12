import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const planId = resolvedParams.id

    if (!planId) {
      return NextResponse.json({ error: 'plan_id required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('heater_manufacturing_plan_details')
      .select('*')
      .eq('plan_id', planId)
      .order('model', { ascending: true })

    if (error) {
      console.error('get plan details error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (err) {
    console.error('manufacturing plan details get error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
