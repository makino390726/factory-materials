const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://zlsjsdvkrjkywfpkjqew.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsc2pzZHZrcmpreXdmcGtqcWV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDUzMzczMDAsImV4cCI6MTg2MzExNzMwMH0.E9i-f8jDmB49sBRVwmyqWMJm0AzwE2E0gY-JdakwbYY'

const supabase = createClient(supabaseUrl, supabaseKey)

async function fixDates() {
  try {
    console.log('2001年のレコードを取得中...')
    
    // 2001年のレコード取得
    const { data: movements, error: fetchError } = await supabase
      .from('stock_movements')
      .select('id, created_at, product_code')
      .gte('created_at', '2001-01-01')
      .lt('created_at', '2002-01-01')
    
    if (fetchError) {
      console.error('取得エラー:', fetchError)
      return
    }
    
    if (!movements || movements.length === 0) {
      console.log('修正対象のレコードがありません')
      return
    }
    
    console.log(`修正対象: ${movements.length}件`)
    console.log('サンプル:', movements.slice(0, 3))
    
    // 各レコードの時刻を保持しながら日付をリセット
    const updates = movements.map((movement) => {
      const originalDate = new Date(movement.created_at)
      const hours = String(originalDate.getHours()).padStart(2, '0')
      const minutes = String(originalDate.getMinutes()).padStart(2, '0')
      const seconds = String(originalDate.getSeconds()).padStart(2, '0')
      
      return {
        id: movement.id,
        created_at: `2026-03-12T${hours}:${minutes}:${seconds}`,
      }
    })
    
    console.log('\n修正内容（最初の3件）:')
    updates.slice(0, 3).forEach((u) => {
      console.log(`  ID: ${u.id}, 新日時: ${u.created_at}`)
    })
    
    // バッチで更新
    console.log('\n更新を実行中...')
    const { error: updateError } = await supabase
      .from('stock_movements')
      .upsert(updates)
    
    if (updateError) {
      console.error('更新エラー:', updateError)
      return
    }
    
    console.log(`\n✅ ${movements.length}件のレコードを修正しました！`)
    console.log(`修正した日付: 2026-03-12`)
    
  } catch (err) {
    console.error('エラー:', err)
  }
}

fixDates()
