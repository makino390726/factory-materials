import { NextRequest, NextResponse } from 'next/server'
import { parseSetWorkbook, saveSetProducts } from '@/lib/set-products'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'ファイルを選択してください' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseSetWorkbook(buffer, file.name || 'セット品リスト.xlsx')
    if (parsed.sets.length === 0) {
      return NextResponse.json(
        { success: false, error: 'セット品を読み取れませんでした', warnings: parsed.warnings },
        { status: 400 }
      )
    }

    saveSetProducts(parsed)
    return NextResponse.json({
      success: true,
      count: parsed.sets.length,
      warnings: parsed.warnings,
    })
  } catch (error) {
    console.error('セット品取込エラー:', error)
    const message = error instanceof Error ? error.message : 'セット品リストの取込に失敗しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
