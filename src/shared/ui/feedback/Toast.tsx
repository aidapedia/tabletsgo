import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CloseIcon } from '@/shared/ui/icons'

const ToastContext = createContext(null)
let counter = 0

const ICONS = {
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </svg>
  ),
}

const TONE = {
  success: 'text-green-bright',
  error: 'text-[#ff9b9b]',
  info: 'text-ink',
}

function ToastItem({ toast, onClose }) {
  return (
    <div className={`flex w-[320px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-soft border border-edge-strong bg-elevated px-4 py-3 ${
      toast.leaving ? 'animate-toast-out' : 'animate-toast-in'
    }`}>
      <span className={`mt-0.5 shrink-0 ${TONE[toast.type]}`}>{ICONS[toast.type]}</span>
      <div className="min-w-0 flex-1 text-xs leading-relaxed text-ink">{toast.message}</div>
      <button className="shrink-0 text-ink-faint hover:text-ink" onClick={onClose} aria-label="Dismiss">
        <CloseIcon width={14} height={14} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  // Play the exit animation first, then drop the toast from the list.
  const remove = useCallback((id) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 200)
  }, [])

  const push = useCallback(
    (type, message, opts: any = {}) => {
      const id = ++counter
      setToasts((t) => [...t, { id, type, message }])
      const duration = opts.duration ?? (type === 'error' ? 6000 : 3500)
      if (duration) setTimeout(() => remove(id), duration)
      return id
    },
    [remove]
  )

  const toast = useMemo(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      info: (m, o) => push('info', m, o),
    }),
    [push]
  )

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onClose={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
