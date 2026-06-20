'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type ModalOverlayProps = {
  open: boolean
  onClose?: () => void
  closeOnBackdrop?: boolean
  zIndex?: number
  panelClassName?: string
  children: React.ReactNode
}

export default function ModalOverlay({
  open,
  onClose,
  closeOnBackdrop = true,
  zIndex = 50,
  panelClassName = 'w-full max-w-2xl',
  children,
}: ModalOverlayProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex }}
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-hidden="true"
        onClick={closeOnBackdrop && onClose ? onClose : undefined}
      />
      <div
        className={`relative max-h-[90vh] overflow-y-auto ${panelClassName}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
