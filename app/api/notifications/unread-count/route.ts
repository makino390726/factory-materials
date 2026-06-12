import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// GET: 未読通知数を取得
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const staffId = searchParams.get('staff_id')

    if (!staffId) {
      return NextResponse.json(
        { error: 'staff_id is required' },
        { status: 400 }
      )
    }

    const url = `${SUPABASE_URL}/rest/v1/notifications?staff_id=eq.${staffId}&is_read=eq.false&select=id`

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })

    if (!response.ok) {
      throw new Error('Failed to fetch unread count')
    }

    const notifications = await response.json()
    
    return NextResponse.json({
      staff_id: staffId,
      unread_count: notifications.length
    })
  } catch (error) {
    console.error('GET /api/notifications/unread-count error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
