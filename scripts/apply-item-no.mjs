import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const sql = readFileSync(new URL('../migrate-work-instruction-item-no.sql', import.meta.url), 'utf8')
const updates = []
for (const line of sql.split('\n')) {
  const match = line.match(
    /SET item_no = '([^']*)' WHERE source = 'excel' AND doc_type = '([^']*)' AND sort_no = (\d+)/
  )
  if (match) updates.push({ item_no: match[1], doc_type: match[2], sort_no: Number(match[3]) })
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
let done = 0
const size = 20
for (let index = 0; index < updates.length; index += size) {
  const chunk = updates.slice(index, index + size)
  await Promise.all(
    chunk.map((row) =>
      supabase
        .from('work_instruction_progress')
        .update({ branch_no: row.item_no })
        .eq('source', 'excel')
        .eq('doc_type', row.doc_type)
        .eq('sort_no', row.sort_no)
        .is('parent_sort_no', null)
        .is('branch_no', null)
    )
  )
  done += chunk.length
  if (done % 200 === 0 || done === updates.length) console.log(done, '/', updates.length)
}
