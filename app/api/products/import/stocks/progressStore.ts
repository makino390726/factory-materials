type ImportProgress = {
  status: 'running' | 'done' | 'error'
  total: number
  processed: number
  successCount: number
  errorCount: number
  message?: string
  startedAt: string
  finishedAt?: string
}

const store = new Map<string, ImportProgress>()

export function createJob(): string {
  const id = crypto.randomUUID()
  store.set(id, {
    status: 'running',
    total: 0,
    processed: 0,
    successCount: 0,
    errorCount: 0,
    startedAt: new Date().toISOString(),
  })
  return id
}

export function getJob(id: string): ImportProgress | null {
  return store.get(id) || null
}

export function updateJob(id: string, partial: Partial<ImportProgress>) {
  const current = store.get(id)
  if (!current) return
  store.set(id, { ...current, ...partial })
}

export function finishJob(id: string, status: 'done' | 'error', message?: string) {
  updateJob(id, {
    status,
    message,
    finishedAt: new Date().toISOString(),
  })
}
