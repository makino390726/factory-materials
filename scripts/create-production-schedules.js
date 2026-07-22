/**
 * production_schedules テーブルを作成する。
 * 使い方: node scripts/create-production-schedules.js
 * （.env.local の NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を使用）
 *
 * Note: Supabase JS では DDL を直接実行できないため、
 * Database URL（POSTGRES）がある場合は pg 経由、なければ SQL 表示のみ。
 */
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const key = m[1]
    let value = m[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function splitSql(sql) {
  return sql
    .split(';')
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim()
    )
    .filter(Boolean)
}

async function tryPg(statements) {
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL
  if (!dbUrl) return false

  let Client
  try {
    ;({ Client } = require('pg'))
  } catch {
    console.log('pg パッケージがありません。npm i pg でインストールするか、SQL Editor で実行してください。')
    return false
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    for (const st of statements) {
      await client.query(st)
      console.log('OK:', st.slice(0, 60).replace(/\s+/g, ' '))
    }
  } finally {
    await client.end()
  }
  return true
}

async function main() {
  loadEnvLocal()
  const sqlPath = path.join(__dirname, '..', 'create-production-schedules.sql')
  const statements = splitSql(fs.readFileSync(sqlPath, 'utf8'))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  const { error: existsError } = await supabase.from('production_schedules').select('id').limit(1)
  if (!existsError) {
    console.log('TABLE_EXISTS')
    return
  }
  console.log('テーブル未作成:', existsError.message)

  const viaPg = await tryPg(statements)
  if (viaPg) {
    const { error } = await supabase.from('production_schedules').select('id').limit(1)
    console.log(error ? `VERIFY_FAIL ${error.message}` : 'VERIFY_OK')
    return
  }

  console.log('')
  console.log('自動DDLはできません。Supabase SQL Editor で次を実行してください:')
  console.log('---')
  console.log(fs.readFileSync(sqlPath, 'utf8'))
  console.log('---')
  process.exit(2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
