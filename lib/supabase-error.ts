type PostgrestErrorLike = {
  code?: string
  message?: string
}

export function isMissingColumnError(
  error: PostgrestErrorLike | null | undefined,
  column: string
) {
  if (!error) return false
  const message = error.message || ''
  return (
    error.code === 'PGRST204' ||
    (message.includes('column') && message.includes(column))
  )
}

export function formatPostgrestError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const record = error as PostgrestErrorLike
    if (isMissingColumnError(record, 'common_group_label')) {
      return (
        '共通明細用のDBカラムがありません。Supabase SQL Editor で migrate-add-line-part-common-group.sql を実行してください。'
      )
    }
    if (record.message) return record.message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export const LINE_PART_COMMON_GROUP_MIGRATION_HINT =
  'Supabase ダッシュボード → SQL Editor で migrate-add-line-part-common-group.sql を実行してください。'
