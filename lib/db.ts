import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

export async function query(
  sql: string,
  params?: (string | number | null)[]
): Promise<{ rows: any[] }> {
  try {
    const { data, error } = await supabase.rpc('exec_query', {
      sql_query: sql,
      params: params || [],
    })

    if (error) {
      console.error('❌ Database error:', error)
      throw error
    }

    console.log('✅ Query executed:', { sql, duration: 'N/A', rows: data?.length || 0 })
    return { rows: data || [] }
  } catch (error) {
    console.error('❌ Database error:', error)
    throw error
  }
}
