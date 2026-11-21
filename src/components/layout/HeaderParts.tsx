import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, CalendarDays, ChevronDown, ChevronRight, LogOut, Settings as SettingsIcon, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { NAV } from './nav'
import { usePeriod } from './PeriodContext'
import { useAuth } from '../../auth/AuthContext'
import { useDashboard } from '../../features/dashboard/useDashboard'
import { buildAlerts } from '../../features/dashboard/alerts'
import { presetRange, PRESET_LABEL, type Preset } from '../../lib/dates'
import { fmtDate } from '../../lib/format'
import { ROLE_LABEL } from '../../lib/types'

function usePop() {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', c); window.addEventListener('keydown', k); return () => { window.removeEventListener('mousedown', c); window.removeEventListener('keydown', k) }
  }, [])
  return { open, setOpen, ref }
}
const Pop = ({ children, className }: { children: ReactNode; className?: string }) => <div className={clsx('absolute right-0 top-11 z-50 rounded-md border border-slate2-200 bg-white shadow-pop', className)}>{children}</div>

/** Where you are: Dashboard › Sales › Invoice. Parents are links. */
export function Breadcrumbs() {
  const { pathname } = useLocation()
  const seg = pathname.split('/').filter(Boolean)
  if (seg.length === 0) return <nav aria-label="Breadcrumb" className="text-sm font-medium text-charcoal-900">Dashboard</nav>
  const top = NAV.find((n) => n.path === `/${seg[0]}`)
  const second = seg[1] === 'new' ? (seg[0] === 'sales' ? 'New sale' : 'New') : seg[2] === 'edit' ? 'Edit draft' : seg[1] ? 'Details' : null
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link to="/" className="text-slate2-500 hover:text-charcoal-900">Dashboard</Link><ChevronRight size={13} className="text-slate2-300" />
      {second ? <><Link to={`/${seg[0]}`} className="text-slate2-500 hover:text-charcoal-900">{top?.label ?? seg[0]}</Link><ChevronRight size={13} className="text-slate2-300" /><span className="font-medium text-charcoal-900">{second}</span></>
        : <span className="font-medium text-charcoal-900">{top?.label ?? 'Reports'}</span>}
    </nav>
  )
}

/** Reporting period for the dashboard. */
export function PeriodPicker() {
  const { preset, setPreset, custom, setCustom, range, label } = usePeriod(); const { open, setOpen, ref } = usePop()
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} className="flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-slate2-200 bg-white/70 px-3 text-sm hover:bg-white"><CalendarDays size={15} className="text-slate2-500" /><span className="font-medium">{label}</span><ChevronDown size={14} className="text-slate2-400" /></button>
      {open && (
        <Pop className="w-64 p-1.5">
          {(Object.keys(PRESET_LABEL) as Preset[]).filter((p) => p !== 'custom').map((p) => (
            <button key={p} onClick={() => { setPreset(p); setOpen(false) }} className={clsx('flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-left text-sm hover:bg-slate2-100', preset === p && 'bg-slate2-100 font-medium')}><span>{PRESET_LABEL[p]}</span><span className="text-xs text-slate2-400">{fmtDate(presetRange(p as Exclude<Preset, 'custom'>).from)}</span></button>))}
          <div className="mt-1 border-t border-slate2-100 px-2.5 pb-2 pt-2.5"><p className="mb-1.5 text-xs font-medium text-slate2-500">Custom range</p>
            <div className="flex items-center gap-1.5"><input type="date" aria-label="From date" className="input !px-2 !py-1.5" value={custom.from} max={custom.to} onChange={(e) => { setCustom({ ...custom, from: e.target.value }); setPreset('custom') }} /><input type="date" aria-label="To date" className="input !px-2 !py-1.5" value={custom.to} min={custom.from} onChange={(e) => { setCustom({ ...custom, to: e.target.value }); setPreset('custom') }} /></div>
            {preset === 'custom' && <p className="mt-1.5 text-xs text-slate2-500">{fmtDate(range.from)} – {fmtDate(range.to)}</p>}</div>
        </Pop>)}
    </div>
  )
}

/** Meaningful alerts only; count badge hides when there is nothing to act on. */
export function Notifications({ dark }: { dark?: boolean }) {
  const { can } = useAuth(); const { open, setOpen, ref } = usePop()
  const { data } = useDashboard(presetRange('month'))
  if (!can('dashboard', 'view')) return null
  const alerts = data ? buildAlerts(data) : []; const urgent = alerts.filter((a) => a.tone !== 'neutral').length
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-label={`Notifications${urgent ? `, ${urgent} need attention` : ''}`} aria-expanded={open} className={clsx('relative flex h-9 w-9 items-center justify-center rounded-md', dark ? 'text-slate2-200 hover:bg-white/10' : 'border border-slate2-200 bg-white/70 text-slate2-600 hover:bg-white')}>
        <Bell size={17} />{urgent > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white">{urgent}</span>}</button>
      {open && (
        <Pop className="w-[min(22rem,calc(100vw-1.5rem))]">
          <p className="border-b border-slate2-100 px-3.5 py-2.5 text-sm font-semibold">Needs attention</p>
          {alerts.length === 0 ? <p className="flex items-center gap-2 px-3.5 py-4 text-sm text-slate2-500"><CheckCircle2 size={16} className="text-ok-500" />Nothing needs attention right now.</p> : (
            <ul className="max-h-96 divide-y divide-slate2-100 overflow-y-auto">{alerts.map((a, i) => (
              <li key={i}><Link to={a.to ?? '/'} onClick={() => setOpen(false)} className="flex gap-2.5 px-3.5 py-2.5 hover:bg-slate2-50"><span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tone === 'red' ? 'bg-bad-500' : a.tone === 'amber' ? 'bg-brand-400' : 'bg-slate2-300')} /><span className="min-w-0 text-sm"><span className="block font-medium">{a.title}</span><span className="block text-xs text-slate2-500">{a.detail}</span></span></Link></li>))}</ul>)}
        </Pop>)}
    </div>
  )
}

export function ProfileMenu() {
  const { session, perms, signOut, can } = useAuth(); const { open, setOpen, ref } = usePop()
  const email = session?.user.email ?? ''; const initials = (email.split('@')[0] || '?').slice(0, 2).toUpperCase()
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-label="Account menu" aria-expanded={open} className="flex h-9 w-9 items-center justify-center rounded-full bg-charcoal-900 text-xs font-semibold text-white hover:bg-charcoal-700">{initials}</button>
      {open && (
        <Pop className="w-60 p-1.5">
          <div className="border-b border-slate2-100 px-2.5 pb-2 pt-1.5"><p className="truncate text-sm font-medium">{email}</p><p className="text-xs text-slate2-500">{perms?.role ? ROLE_LABEL[perms.role] : 'No role assigned'}</p></div>
          {can('settings', 'view') && <Link to="/settings" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm hover:bg-slate2-100"><SettingsIcon size={15} className="text-slate2-500" />Settings</Link>}
          <button onClick={signOut} className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-slate2-100"><LogOut size={15} className="text-slate2-500" />Sign out</button>
        </Pop>)}
    </div>
  )
}
