import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { inferProductCategory } from '@/lib/product-category'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/heater/models/backfill-categories
 * product_category が空の機種マスタへ、機種コード／名称から推定したカテゴリを書き込む
 */
export async function POST() {
  try {
    const { data: models, error } = await supabase
      .from('heater_models')
      .select('model, name, product_category')
      .order('model')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let updated = 0
    let skipped = 0
    const samples: Array<{ model: string; product_category: string }> = []

    for (const row of models || []) {
      const current = String(row.product_category || '').trim()
      if (current) {
        skipped += 1
        continue
      }
      const product_category = inferProductCategory(String(row.model), row.name)
      const { error: updateError } = await supabase
        .from('heater_models')
        .update({ product_category })
        .eq('model', row.model)

      if (updateError) {
        if (String(updateError.message || '').includes('product_category')) {
          return NextResponse.json(
            {
              error:
                'product_category 列がありません。Supabase で機種マスタのカテゴリ列を追加してください。',
              detail: updateError.message,
            },
            { status: 500 }
          )
        }
        continue
      }
      updated += 1
      if (samples.length < 20) {
        samples.push({ model: String(row.model), product_category })
      }
    }

    return NextResponse.json({
      success: true,
      total: (models || []).length,
      updated,
      skipped,
      samples,
      message: `カテゴリ未設定 ${updated} 件を推定カテゴリで更新しました`,
    })
  } catch (e) {
    console.error('backfill-categories error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'カテゴリ補完に失敗しました' },
      { status: 500 }
    )
  }
}
