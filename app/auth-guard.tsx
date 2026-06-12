'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

type AuthGuardProps = {
  children: React.ReactNode
}

const PUBLIC_PATHS = new Set(['/login', '/work-orders/cost', '/manufacturing-plan-allocation'])

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isReady, setIsReady] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

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
    const isPublic = PUBLIC_PATHS.has(pathname)
    const isAuthenticated = hasValidStaffSession()
    setIsLoggedIn(isAuthenticated)

    if (!isAuthenticated) {
      sessionStorage.removeItem('staff')
    }

    if (!isAuthenticated && !isPublic) {
      router.replace('/login')
      return
    }

    setIsReady(true)
  }, [pathname, router])

  const handleLogout = () => {
    sessionStorage.removeItem('staff')
    setIsLoggedIn(false)
    router.replace('/login')
  }

  if (!isReady && !PUBLIC_PATHS.has(pathname)) {
    return null
  }

  return (
    <>
      {children}
      {!PUBLIC_PATHS.has(pathname) && isLoggedIn ? (
        <button
          type="button"
          onClick={handleLogout}
          aria-label="ログアウト"
          className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-slate-900/80 text-white shadow-lg backdrop-blur transition hover:bg-slate-800"
        >
          ×
        </button>
      ) : null}
    </>
  )
}
