import { NextRequest, NextResponse } from 'next/server'
import {
  createSetProduct,
  deleteSetProduct,
  loadSetProducts,
  updateSetProduct,
  type SetProduct,
} from '@/lib/set-products'

function toSummary(setProduct: SetProduct) {
  return {
    id: setProduct.id,
    sheet_name: setProduct.sheet_name,
    set_code: setProduct.set_code,
    set_name: setProduct.set_name,
    item_count: setProduct.items.length,
    items: setProduct.items,
  }
}

export async function GET() {
  try {
    const file = loadSetProducts()
    return NextResponse.json({
      success: true,
      source_name: file.source_name,
      imported_at: file.imported_at,
      warnings: file.warnings,
      sets: file.sets.map((setProduct) => ({
        id: setProduct.id,
        sheet_name: setProduct.sheet_name,
        set_code: setProduct.set_code,
        set_name: setProduct.set_name,
        item_count: setProduct.items.length,
      })),
    })
  } catch (error) {
    console.error('セット品一覧エラー:', error)
    return NextResponse.json(
      { success: false, error: 'セット品一覧の取得に失敗しました' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const created = createSetProduct(body)
    return NextResponse.json({ success: true, set: toSummary(created) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'セット品の登録に失敗しました'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) {
      return NextResponse.json({ success: false, error: 'セット品を指定してください' }, { status: 400 })
    }
    const updated = updateSetProduct(id, body)
    return NextResponse.json({ success: true, set: toSummary(updated) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'セット品の更新に失敗しました'
    const status = message === 'セット品が見つかりません' ? 404 : 400
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) {
      return NextResponse.json({ success: false, error: 'セット品を指定してください' }, { status: 400 })
    }
    const removed = deleteSetProduct(id)
    return NextResponse.json({ success: true, set: toSummary(removed) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'セット品の削除に失敗しました'
    const status = message === 'セット品が見つかりません' ? 404 : 400
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
