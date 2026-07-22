/**
 * 申請書CSVを作業日報へ取込（上書き）
 * Usage: npx tsx scripts/import-shinsei-work-reports.ts [path]
 */
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { importShinseiWorkReports } from '../lib/shinsei-work-report-import'

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i <= 0) continue
    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

async function main() {
  loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env missing')

  const csvPath =
    process.argv[2] || path.join(process.cwd(), 'exports', 'shinsei-work-reports.csv')
  const buf = fs.readFileSync(csvPath)
  const wb = XLSX.read(buf, { type: 'buffer', codepage: 932, raw: false })
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
    defval: '',
    raw: false,
  })

  const supabase = createClient(url, key)
  console.log('importing', rows.length, 'rows from', csvPath)
  const summary = await importShinseiWorkReports(supabase, rows, { syncMonthly: true })
  const out = path.join(process.cwd(), 'exports', 'shinsei-import-result.json')
  fs.writeFileSync(out, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({
    imported: summary.imported,
    created: summary.created,
    overwritten: summary.overwritten,
    failed: summary.failed.length,
    missing_staff_count: summary.missing_staff.length,
    name_matched_staff_count: summary.name_matched_staff.length,
    missing_lines: summary.missing_lines,
    months_synced: summary.months_synced.length,
  }, null, 2))
  console.log('wrote', out)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
