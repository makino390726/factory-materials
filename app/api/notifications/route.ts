import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type Notification = {
  id: number
  staff_id: string
  message: string
  notification_type: string
  is_read: boolean
  created_at: string
  read_at: string | null
  created_by: string | null
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// GET: 通知一覧取得（特定スタッフまたは全件）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const staffId = searchParams.get('staff_id')
    const unreadOnly = searchParams.get('unread_only') === 'true'

    let url = `${SUPABASE_URL}/rest/v1/notifications?order=created_at.desc`
    
    if (staffId) {
      url += `&staff_id=eq.${staffId}`
    }
    
    if (unreadOnly) {
      url += `&is_read=eq.false`
    }

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })

    if (!response.ok) {
      throw new Error('Failed to fetch notifications')
    }

    const notifications: Notification[] = await response.json()
    
    return NextResponse.json({
      notifications,
      unread_count: notifications.filter(n => !n.is_read).length
    })
  } catch (error) {
    console.error('GET /api/notifications error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// POST: 通知作成（日報催促など）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { staff_id, message, notification_type = 'info', created_by } = body

    if (!staff_id || !message) {
      return NextResponse.json(
        { error: 'staff_id and message are required' },
        { status: 400 }
      )
    }

    const notification = {
      staff_id,
      message,
      notification_type,
      created_by,
      is_read: false,
      created_at: new Date().toISOString()
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(notification),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to create notification')
    }

    const created = await response.json()
    return NextResponse.json(created[0])
  } catch (error) {
    console.error('POST /api/notifications error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// PUT: 通知を既読にする
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { notification_id, staff_id } = body

    if (!notification_id) {
      return NextResponse.json(
        { error: 'notification_id is required' },
        { status: 400 }
      )
    }

    const updateData = {
      is_read: true,
      read_at: new Date().toISOString()
    }

    let url = `${SUPABASE_URL}/rest/v1/notifications?id=eq.${notification_id}`
    
    // スタッフIDが指定されている場合は、そのスタッフの通知のみ更新
    if (staff_id) {
      url += `&staff_id=eq.${staff_id}`
    }

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(updateData),
    })

    if (!response.ok) {
      throw new Error('Failed to update notification')
    }

    const updated = await response.json()
    return NextResponse.json(updated[0] || { success: true })
  } catch (error) {
    console.error('PUT /api/notifications error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// DELETE: 通知削除
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const notificationId = searchParams.get('id')

    if (!notificationId) {
      return NextResponse.json(
        { error: 'notification id is required' },
        { status: 400 }
      )
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?id=eq.${notificationId}`,
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    )

    if (!response.ok) {
      throw new Error('Failed to delete notification')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/notifications error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
