import type { SupabaseClient } from '@supabase/supabase-js'

const PAGE_SIZE = 1000
const ID_CHUNK = 100

/** 期間内の作業日報を、1000件制限を超えて全件取得する */
export async function fetchWorkReportsInRange<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  from: string,
  to: string,
  select: string
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('work_reports')
      .select(select)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const batch = (data || []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

/**
 * `.in(column, ids)` を分割して取得する。
 * 期間が長いと ID が数百〜数千になり、1回の in() は URL 長制限で Bad Request になる。
 */
export async function fetchByIdChunks<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  column: string,
  ids: string[],
  extra?: (query: any) => any
): Promise<T[]> {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))]
  if (uniqueIds.length === 0) return []

  const rows: T[] = []
  for (let i = 0; i < uniqueIds.length; i += ID_CHUNK) {
    const chunk = uniqueIds.slice(i, i + ID_CHUNK)
    let offset = 0
    while (true) {
      let query = supabase.from(table).select(select).in(column, chunk).order('id', { ascending: true })
      if (extra) query = extra(query) as typeof query
      const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      const batch = (data || []) as T[]
      rows.push(...batch)
      if (batch.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
  }
  return rows
}
