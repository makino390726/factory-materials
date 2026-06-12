'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function LoginPage() {
  const router = useRouter()
  const [loginId, setLoginId] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hasValidStaffSession = () => {
    try {
      const raw = sessionStorage.getItem('staff')
      if (!raw) return false
      const parsed = JSON.parse(raw)
      return Boolean(parsed && typeof parsed === 'object' && parsed.id && parsed.login_id)
    } catch {
      return false
    }
  }

  useEffect(() => {
    if (hasValidStaffSession()) {
      router.replace('/')
    } else {
      sessionStorage.removeItem('staff')
    }
  }, [router])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    if (!loginId.trim()) {
      setError('ログインIDを入力してください')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ login_id: loginId.trim() }),
      })

      const result = (await response.json()) as
        | { success: true; staff: { id: string; login_id: string; name: string; department?: string | null } }
        | { success: false; error: string }

      if (!response.ok || !result.success) {
        setError('error' in result ? result.error : 'ログインに失敗しました')
        return
      }

      sessionStorage.setItem('staff', JSON.stringify(result.staff))
      router.push('/')
    } catch (submitError) {
      console.error('ログイン処理エラー:', submitError)
      setError('通信エラーが発生しました')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_#f9a8d4_40%,_#0f172a_100%)] relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute -top-24 right-[-10%] h-72 w-72 rounded-full bg-amber-300/30 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-8%] h-80 w-80 rounded-full bg-teal-300/30 blur-3xl" />
        <div className="absolute inset-0 opacity-30 bg-[linear-gradient(120deg,_rgba(15,23,42,0.1)_0%,_rgba(15,23,42,0.1)_1%,_transparent_1%,_transparent_6%)] [background-size:32px_32px]" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-white/30 bg-white/80 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.25)] backdrop-blur animate-card">
          <div className="space-y-4 text-center animate-fade-up">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-2xl text-amber-200 shadow-lg">
              🔐
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Factory Materials</p>
              <h1 className="text-3xl font-semibold text-slate-900">スタッフログイン</h1>
              <p className="text-sm text-slate-500">ログインIDを入力して作業を開始します。</p>
            </div>
          </div>

          <form className="mt-8 space-y-5 animate-fade-up" onSubmit={handleSubmit} style={{ animationDelay: '120ms' }}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="loginId">
                ログインID
              </label>
              <input
                id="loginId"
                name="loginId"
                type="text"
                inputMode="text"
                autoComplete="off"
                value={loginId}
                onChange={event => setLoginId(event.target.value)}
                placeholder="例: staff-001"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 shadow-sm transition focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100"
              />
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-400/40 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSubmitting ? '確認中...' : 'ログイン'}
            </button>
          </form>

          <div
            className="mt-8 rounded-2xl bg-slate-900/95 px-4 py-4 text-sm text-slate-100 animate-fade-up"
            style={{ animationDelay: '220ms' }}
          >
            <p className="font-semibold">利用メモ</p>
            <p className="mt-1 text-slate-300">部署ごとに割り当てられたログインIDを入力してください。</p>
          </div>
        </div>
      </div>

      <style jsx>{`
        .animate-card {
          animation: card-pop 0.7s ease-out both;
        }

        .animate-fade-up {
          animation: fade-up 0.7s ease-out both;
        }

        @keyframes card-pop {
          0% {
            opacity: 0;
            transform: translateY(24px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes fade-up {
          0% {
            opacity: 0;
            transform: translateY(16px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
