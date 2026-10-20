import fs from 'fs'
import { parseSetWorkbook, saveSetProducts } from '../lib/set-products'

const sourcePath = process.argv[2]
if (!sourcePath) {
  console.error('使い方: node scripts/build-set-products.ts <セット品リスト.xlsx>')
  process.exit(1)
}

const parsed = parseSetWorkbook(fs.readFileSync(sourcePath), 'セット品リスト.xlsx')
saveSetProducts(parsed)

for (const set of parsed.sets) {
  console.log(
    `${set.id}\t${set.set_code || '-'}\t${set.set_name}\t${set.items.length}点\t${set.sheet_name}`
  )
}
if (parsed.warnings.length > 0) {
  console.log('warnings')
  for (const warning of parsed.warnings) console.log(warning)
}
