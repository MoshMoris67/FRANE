import { Children, cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { X, Loader2, AlertTriangle, SlidersHorizontal } from 'lucide-react'
import clsx from 'clsx'

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal-950/60 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx('flex max-h-[94dvh] w-full flex-col rounded-t-lg bg-white shadow-pop sm:rounded-lg', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate2-200 px-4 py-3 sm:px-5">
          <h2 className="font-display text-xl font-semibold tracking-tight text-charcoal-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate2-500 hover:bg-slate2-100"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-slate2-200 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate2-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  neutral: 'bg-slate2-100 text-slate2-700 ring-slate2-400/30',
  orange: 'bg-brand-50 text-brand-700 ring-brand-600/20',
}
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', TONES[tone])}>{children}</span>
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate2-500"><Loader2 className="animate-spin" size={18} />{label}</div>
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const m = (error as { message?: string })?.message ?? String(error)
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1"><p className="font-semibold">Something went wrong</p><p className="mt-0.5 break-words">{m}</p></div>
      {retry && <button className="btn-ghost !py-1" onClick={retry}>Retry</button>}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate2-100 p-3 text-slate2-500">{icon}</div>}
      <p className="font-semibold text-charcoal-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate2-500">{children}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-[2.1rem] font-semibold leading-none tracking-tight text-charcoal-900">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-slate2-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Notice({ tone = 'amber', children }: { tone?: 'amber' | 'red' | 'green' | 'neutral'; children: ReactNode }) {
  const c = { amber: 'border-amber-300 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-800', green: 'border-emerald-200 bg-emerald-50 text-emerald-800', neutral: 'border-slate2-200 bg-slate2-100 text-slate2-700' }[tone]
  return <div className={clsx('rounded-md border px-3 py-2 text-sm', c)}>{children}</div>
}

/** List filters. Desktop: the usual grid. Phone: the first control (search) plus a "Filters" button; the rest open on tap, so the data comes first. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const kids = Children.toArray(children).filter(isValidElement) as ReactElement<{ className?: string }>[]
  const [first, ...rest] = kids
  return (
    <div className={clsx('card mb-4 grid grid-cols-[1fr_auto] gap-3 p-3 sm:grid-cols-2', className)}>
      {first}
      {rest.length > 0 && <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn-ghost sm:hidden"><SlidersHorizontal size={16} />Filters</button>}
      {rest.map((k, i) => cloneElement(k, { key: i, className: clsx(k.props.className, 'max-sm:col-span-2', !open && 'max-sm:hidden') }))}
    </div>
  )
}
