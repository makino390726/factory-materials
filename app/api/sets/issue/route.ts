import { NextRequest, NextResponse } from 'next/server'
import { issueSetProduct } from '@/lib/set-product-stock'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await issueSetProduct({
      setId: String(body.set_id || ''),
      setCount: body.set_count,
      loginId: body.login_id ? String(body.login_id) : null,
      staffName: body.staff_name ? String(body.staff_name) : null,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: '在庫が足りない商品があるため、払い出しを中止しました',
          shortages: result.shortages,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      issued_count: result.issuedCount,
      note: result.note,
      lines: result.lines,
    })
  } catch (error) {
    console.error('セット払い出しエラー:', error)
    const message = error instanceof Error ? error.message : '払い出しに失敗しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
