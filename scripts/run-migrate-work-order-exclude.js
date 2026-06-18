const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('環境変数が不足しています')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  const sqlPath = path.join(__dirname, '..', 'migrate-add-work-order-exclude-from-work-report.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'))

  for (const statement of statements) {
    const { error } = await supabase.rpc('exec_query', { sql_query: statement, params: [] })
    if (error) {
      console.error('失敗:', statement.slice(0, 80), '...', error.message)
      process.exit(1)
    }
    console.log('OK:', statement.split('\n')[0])
  }

  const { data, error } = await supabase
    .from('work_orders')
    .select('exclude_from_work_report')
    .limit(1)

  if (error) {
    console.error('列確認失敗:', error.message)
    process.exit(1)
  }

  console.log('マイグレーション完了', data)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
