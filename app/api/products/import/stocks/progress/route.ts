import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '../progressStore'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')

  if (!jobId) {
    return NextResponse.json({ error: 'jobIdが必要です' }, { status: 400 })
  }

  const job = getJob(jobId)

  if (!job) {
    return NextResponse.json({
      success: true,
      job: {
        status: 'done',
        total: 0,
        processed: 0,
        successCount: 0,
        errorCount: 0,
        message: 'インポートが完了しました',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    })
  }

  return NextResponse.json({ success: true, job })
}
