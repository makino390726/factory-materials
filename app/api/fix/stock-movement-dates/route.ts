import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  try {
    const { incorrectYear, correctDate } = await request.json()

    if (!incorrectYear || !correctDate) {
      return Response.json(
        { error: '不正な日付データが含まれます' },
        { status: 400 }
      )
    }

    // 2001年のレコードを取得
    const { data: movements, error: fetchError } = await supabase
      .from('stock_movements')
      .select('id, created_at')
      .gte('created_at', `${incorrectYear}-01-01`)
      .lt('created_at', `${incorrectYear + 1}-01-01`)

    if (fetchError) throw fetchError

    if (!movements || movements.length === 0) {
      return Response.json({
        success: true,
        message: '修正対象のレコードがありません',
        count: 0,
      })
    }

    // 各レコードについて、時刻を保持しながら日付を修正
    const updates = movements.map((movement) => {
      const originalDate = new Date(movement.created_at)
      const time = originalDate.toLocaleTimeString('en-GB', {
        hour12: false,
      })
      return {
        id: movement.id,
        created_at: `${correctDate}T${time}`,
      }
    })

    // 修正を実行
    const { error: updateError } = await supabase
      .from('stock_movements')
      .upsert(updates, { onConflict: 'id' })

    if (updateError) throw updateError

    return Response.json({
      success: true,
      message: `${movements.length}件のレコードを修正しました`,
      count: movements.length,
      correctedDate: correctDate,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '不明なエラー'
    console.error('修正エラー:', err)
    return Response.json({ error: errorMsg }, { status: 500 })
  }
}
