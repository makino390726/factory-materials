#!/usr/bin/env node
/**
 * import_excel_to_sql.js
 *
 * Reads an Excel file and generates SQL files to replace tables based on sheet headers.
 * Usage examples:
 *  node scripts/import_excel_to_sql.js --file imports/パーツマスタ.xlsx --map "Parts:parts_master,BOM:bom" --out imports/sql
 *  node scripts/import_excel_to_sql.js --file imports/パーツマスタ.xlsx --out imports/sql --exec --conn "postgres://user:pass@host:5432/db"
 */

const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { file: null, map: null, outDir: 'imports/sql', exec: false, conn: '', pk: null, indexes: null }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--file') out.file = args[++i]
    else if (a === '--map') out.map = args[++i]
    else if (a === '--out') out.outDir = args[++i]
    else if (a === '--exec') out.exec = true
    else if (a === '--conn') out.conn = args[++i]
    else if (a === '--pk') out.pk = args[++i]
    else if (a === '--indexes' || a === '--idx') out.indexes = args[++i]
  }
  return out
}

function sanitizeColumnName(name) {
  if (!name && name !== 0) return 'col'
  let s = String(name).trim()
  s = s.replace(/\r|\n/g, ' ')
  s = s.replace(/\s+/g, '_')
  s = s.replace(/[^0-9a-zA-Z_]/g, '')
  s = s.replace(/^([0-9])/, '_$1')
  if (!s) s = 'col'
  return s.toLowerCase()
}

function inferType(values) {
  let hasFloat = false
  let hasInt = false
  let hasText = false
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) hasFloat = true
      else hasInt = true
    } else {
      // check numeric strings
      const num = Number(String(v).trim())
      if (!Number.isNaN(num)) {
        if (String(v).includes('.') || !Number.isInteger(num)) hasFloat = true
        else hasInt = true
      } else {
        hasText = true
      }
    }
    if (hasText) break
  }
  if (hasText) return 'text'
  if (hasFloat) return 'numeric'
  if (hasInt) return 'integer'
  return 'text'
}

function quoteLiteral(val) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return String(val)
  const s = String(val).replace(/'/g, "''")
  return `'${s}'`
}

function generateSQLForSheet(sheetName, rows, tableName, pkCols = [], indexDefs = []) {
  if (!rows || rows.length === 0) return null
  const header = rows[0].map(h => sanitizeColumnName(h || 'col'))
  const data = rows.slice(1)

  // collect column values
  const cols = header.map((h, ci) => data.map(r => (r[ci] === undefined ? null : r[ci])))
  const types = cols.map(c => inferType(c))

  const createCols = header.map((h, i) => `  ${h} ${types[i]}`).join(',\n')
  let create = `DROP TABLE IF EXISTS ${tableName} CASCADE;\nCREATE TABLE ${tableName} (\n${createCols}`
  // add primary key if provided and columns exist
  if (pkCols && pkCols.length > 0) {
    const validPk = pkCols.map(c => sanitizeColumnName(c)).filter(c => header.includes(c))
    if (validPk.length > 0) {
      create += `,\n  PRIMARY KEY (${validPk.join(', ')})`
    }
  }
  create += `\n);\n\n`;

  // inserts
  const inserts = []
  for (const r of data) {
    const vals = header.map((_, i) => quoteLiteral(r[i] === undefined ? null : r[i]))
    inserts.push(`INSERT INTO ${tableName} (${header.join(', ')}) VALUES (${vals.join(', ')});`)
  }

  return create + inserts.join('\n') + '\n'
}

async function main() {
  const args = parseArgs()
  const file = args.file || path.join('imports', 'パーツマスタ.xlsx')
  if (!fs.existsSync(file)) {
    console.error('Excel file not found:', file)
    process.exit(1)
  }

  const outDir = args.outDir || path.join('imports', 'sql')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const wb = XLSX.readFile(file)
  const sheetNames = wb.SheetNames

  // mapping
  const map = {}
  if (args.map) {
    args.map.split(',').forEach(pair => {
      const [sheet, table] = pair.split(':').map(s => s && s.trim())
      if (sheet && table) map[sheet] = table
    })
  }

  // default mapping if not provided: first -> parts_master, second -> bom
  if (Object.keys(map).length === 0) {
    if (sheetNames[0]) map[sheetNames[0]] = 'parts_master'
    if (sheetNames[1]) map[sheetNames[1]] = 'bom'
  }

  const generatedFiles = []

  for (const sName of sheetNames) {
    const table = map[sName]
    if (!table) continue
    const sheet = wb.Sheets[sName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    if (!rows || rows.length === 0) continue
    // determine pk and index definitions for this table from args
    const pkMap = {}
    const idxMap = {}
    if (args.pk) {
      args.pk.split(';').forEach(pair => {
        const [t, cols] = pair.split(':').map(s => s && s.trim())
        if (t && cols) pkMap[t] = cols.split(',').map(c => c.trim())
      })
    }
    if (args.indexes) {
      args.indexes.split(';').forEach(pair => {
        const [t, cols] = pair.split(':').map(s => s && s.trim())
        if (t && cols) idxMap[t] = cols.split(',').map(c => c.trim())
      })
    }
    const pkForTable = pkMap[table] || []
    const indexesForTable = idxMap[table] || []
    let sql = generateSQLForSheet(sName, rows, table, pkForTable, indexesForTable)
    if (!sql) continue
    // append index creation statements
    if (indexesForTable && indexesForTable.length > 0) {
      for (const cols of indexesForTable) {
        const idxCols = cols.split(',').map(c => sanitizeColumnName(c.trim())).join(', ')
        const idxName = `idx_${table}_${idxCols.replace(/[, ]+/g, '_')}`
        sql += `\nCREATE INDEX IF NOT EXISTS ${idxName} ON ${table} (${idxCols});\n`
      }
    }

    const outPath = path.join(outDir, `${table}_replace.sql`)
    fs.writeFileSync(outPath, sql, 'utf8')
    console.log('Wrote', outPath)
    generatedFiles.push(outPath)
  }

  if (args.exec) {
    if (!args.conn) {
      console.error('--exec specified but no --conn provided')
      process.exit(2)
    }
    // execute SQL files using pg
    const { Client } = require('pg')
    const client = new Client({ connectionString: args.conn })
    try {
      await client.connect()
      for (const f of generatedFiles) {
        const sql = fs.readFileSync(f, 'utf8')
        console.log('Executing', f)
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('COMMIT')
      }
      console.log('All executed successfully')
    } catch (e) {
      console.error('Execution failed:', e)
      try { await client.query('ROLLBACK') } catch (_) {}
    } finally {
      await client.end()
    }
  } else {
    console.log('SQL generation complete. Files written to', outDir)
    console.log('To execute, run with --exec --conn "postgres://..."')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
