'use client'

import { useEffect, useState } from 'react'

export const THEME_STORAGE_KEY = 'fm-theme'

export type ThemeMode = 'dark' | 'light'

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* 保存できない環境でも、その場の表示は切り替える */
  }
}

export function ThemeToggle({ reserveLogout }: { reserveLogout?: boolean }) {
  const [theme, setTheme] = useState<ThemeMode>('dark')

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark')
  }, [])

  const choose = (next: ThemeMode) => {
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div
      className={`no-print fixed top-4 z-50 flex overflow-hidden rounded-full border border-slate-300 bg-white text-xs font-semibold shadow-lg ${reserveLogout ? 'right-20' : 'right-4'}`}
      role="group"
      aria-label="表示モード"
    >
      <button
        type="button"
        aria-pressed={theme === 'light'}
        onClick={() => choose('light')}
        className={`px-3 py-2 ${theme === 'light' ? 'bg-red-600 text-white' : 'text-slate-700'}`}
      >
        通常
      </button>
      <button
        type="button"
        aria-pressed={theme === 'dark'}
        onClick={() => choose('dark')}
        className={`px-3 py-2 ${theme === 'dark' ? 'bg-red-600 text-white' : 'text-slate-700'}`}
      >
        ダーク
      </button>
    </div>
  )
}
