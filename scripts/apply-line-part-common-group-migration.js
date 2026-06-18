/**
 * line_part_assignments 共通明細カラムを追加
 *
 * 実行例:
 *   node scripts/apply-line-part-common-group-migration.js "postgresql://postgres.[ref]:[PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
 *
 * または .env.local に DATABASE_URL を設定:
 *   node --env-file=.env.local scripts/apply-line-part-common-group-migration.js
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

async function main() {
  const connectionString = process.argv[2] || process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL または接続文字列引数が必要です。')
    console.error('')
    console.error('Supabase → Project Settings → Database → Connection string (URI) を使用してください。')
    console.error('例: node scripts/apply-line-part-common-group-migration.js "postgresql://..."')
    process.exit(1)
  }

  const sqlPath = path.join(__dirname, '..', 'migrate-add-line-part-common-group.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()
  try {
    await client.query(sql)
    const { rows } = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'line_part_assignments'
         AND column_name IN ('common_group_label', 'allocation_models', 'settings_confirmed')
       ORDER BY column_name`
    )
    console.log('マイグレーション完了。追加カラム:', rows.map((r) => r.column_name).join(', '))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('マイグレーション失敗:', err.message)
  process.exit(1)
})
