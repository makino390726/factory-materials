import { NextRequest, NextResponse } from 'next/server'
import { loadSetIssueLines } from '@/lib/set-product-stock'
import { findSetProduct } from '@/lib/set-products'

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')?.trim() || ''
    if (!id) {
      return NextResponse.json({ success: false, error: 'セット品を指定してください' }, { status: 400 })
    }

    const setProduct = findSetProduct(id)
    if (!setProduct) {
      return NextResponse.json({ success: false, error: 'セット品が見つかりません' }, { status: 404 })
    }

    const lines = await loadSetIssueLines(setProduct)
    return NextResponse.json({
      success: true,
      set: {
        id: setProduct.id,
        sheet_name: setProduct.sheet_name,
        set_code: setProduct.set_code,
        set_name: setProduct.set_name,
      },
      lines,
    })
  } catch (error) {
    console.error('セット品明細エラー:', error)
    const message = error instanceof Error ? error.message : 'セット品明細の取得に失敗しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
