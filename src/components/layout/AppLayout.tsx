import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, LogOut, Plus, Menu, X, Search, ArrowLeftRight } from 'lucide-react'
import clsx from 'clsx'
import { NAV } from './nav'
import { Brand, LogoMark } from '../Logo'
import { useAuth } from '../../auth/AuthContext'
import { useSettings } from '../../features/data'
import { RecordProvider, useRecord } from './RecordContext'
import { PeriodProvider } from './PeriodContext'
import GlobalSearch from './GlobalSearch'
import { Breadcrumbs, Notifications, PeriodPicker, ProfileMenu } from './HeaderParts'
import { ROLE_LABEL } from '../../lib/types'

function SidebarLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can } = useAuth()
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {NAV.filter((n) => can(n.module, 'view')).map((n) => (
        <NavLink key={n.key} to={n.path} end={n.path === '/'} onClick={onNavigate} title={collapsed ? n.label : undefined}
          className={({ isActive }) => clsx('group flex items-center gap-3.5 rounded-md py-[9px] pl-3.5 pr-3 text-[14.5px] transition-colors', collapsed && 'justify-center px-0',
            isActive ? 'bg-gradient-to-r from-brand-600 to-brand-500 font-medium text-white shadow-[0_6px_16px_-6px_rgba(200,101,31,.7)]' : 'text-slate2-200 hover:bg-white/[0.06] hover:text-white')}>
          <n.icon size={20} strokeWidth={1.9} className="shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
        </NavLink>))}
    </nav>
  )
}

/** Brand art card at the foot of the sidebar (only when there is room). */
function PromoCard() {
  return (
    <div className="mx-3 mb-3 hidden overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-charcoal-700 to-charcoal-950 [@media(min-height:860px)]:block">
      <svg viewBox="0 0 200 74" className="block w-full" aria-hidden="true"><defs><linearGradient id="pc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#cfcac0" /><stop offset="1" stopColor="#8b867b" /></linearGradient></defs>
        <g fill="url(#pc)"><path d="M92 16h46v10h-46z" opacity=".85" /><path d="M92 26h46v34h-46z" /><path d="M138 16l12-6v44l-12 6z" opacity=".6" /><path d="M92 16l12-6h46l-12 6z" opacity=".95" /></g>
        <g fill="#2c3033"><rect x="102" y="34" width="10" height="16" rx="1" /><rect x="118" y="34" width="10" height="16" rx="1" /></g>
        <g fill="url(#pc)" opacity=".55"><path d="M40 38h36v22H40z" /><path d="M76 38l9-5v22l-9 5z" opacity=".6" /></g></svg>
      <div className="px-4 pb-1 pt-1"><p className="font-display text-xl font-semibold leading-tight text-white">Build Stronger<br />Together</p></div>
      <svg viewBox="0 0 200 22" className="block w-full" aria-hidden="true"><path d="M0 18C50 18 110 2 200 8" fill="none" stroke="#c8651f" strokeWidth="3" strokeLinecap="round" /></svg>
    </div>
  )
}

function UserBlock({ collapsed }: { collapsed?: boolean }) {
  const { session, perms, signOut } = useAuth(); const email = session?.user.email ?? ''
  return (
    <div className={clsx('flex items-center gap-2.5 border-t border-white/10 p-3', collapsed && 'justify-center')}>
      {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-white">{email}</p><p className="text-xs text-slate2-400">{perms?.role ? ROLE_LABEL[perms.role] : 'No role assigned'}</p></div>}
      <button onClick={signOut} title="Sign out" aria-label="Sign out" className="rounded-sm p-2 text-slate2-400 hover:bg-white/10 hover:text-white"><LogOut size={16} /></button>
    </div>
  )
}

function Shell() {
  const [collapsed, setCollapsed] = useState(() => { try { const v = localStorage.getItem('frane.sidebar'); return v === null ? window.innerWidth < 1280 : v === '1' } catch { return false } })
  const [drawer, setDrawer] = useState(false); const [msearch, setMsearch] = useState(false)
  const { can } = useAuth(); const { openRecord } = useRecord(); const { data: settings } = useSettings(); const loc = useLocation()
  const name = settings?.company.name ?? 'FRANE CONCRETE FACTORY'; const logo = settings?.company.logo_url
  const canRecord = can('transactions', 'create'); const onDash = loc.pathname === '/' && can('dashboard', 'view')
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('frane.sidebar', c ? '0' : '1') } catch { /* ignore */ } return !c })
  useEffect(() => { setDrawer(false); setMsearch(false) }, [loc.pathname])

  const tabs = [
    { to: '/', label: 'Home', icon: NAV[0].icon, module: 'dashboard' },
    { to: '/cashbook', label: 'Cashbook', icon: NAV[1].icon, module: 'cashbook' },
    { to: '/transactions', label: 'Txns', icon: NAV[2].icon, module: 'transactions' },
    { to: '/accounts', label: 'Accounts', icon: NAV.find((n) => n.key === 'accounts')!.icon, module: 'accounts' },
  ].filter((t) => can(t.module, 'view'))

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className={clsx('concrete no-print sticky top-0 hidden h-dvh shrink-0 flex-col bg-charcoal-900 transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-[264px]')}>
        <div className="flex flex-col items-center gap-1 border-b border-white/10 py-5">{collapsed ? <LogoMark size={34} url={logo} /> : <><LogoMark size={52} url={logo} /><p className="font-display text-[2.1rem] font-semibold leading-none tracking-[0.04em] text-white">FRANE</p><p className="text-[11px] font-medium tracking-[0.18em] text-slate2-300">CONCRETE FACTORY</p></>}</div>
        <SidebarLinks collapsed={collapsed} />
        {!collapsed && <PromoCard />}
        <button onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="mx-2.5 mb-1.5 flex items-center justify-center gap-2 rounded-sm py-2 text-xs text-slate2-400 hover:bg-white/[0.05] hover:text-white">{collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} />Collapse</>}</button>
        <UserBlock collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-charcoal-950/60" />
          <aside className="concrete absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-charcoal-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 items-center justify-between border-b border-white/[0.07] px-4"><Brand name={name} compact logoUrl={logo} /><button onClick={() => setDrawer(false)} aria-label="Close menu" className="p-1 text-slate2-300"><X size={20} /></button></div>
            <SidebarLinks onNavigate={() => setDrawer(false)} /><UserBlock />
          </aside>
        </div>)}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="concrete no-print sticky top-0 z-30 flex h-14 items-center justify-between bg-charcoal-900 px-2 lg:hidden">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded-sm p-2.5 text-white"><Menu size={21} /></button>
          <Brand name={name} compact logoUrl={logo} />
          <div className="flex items-center"><button onClick={() => setMsearch(true)} aria-label="Search" className="rounded-sm p-2.5 text-slate2-200"><Search size={19} /></button><Notifications dark /></div>
        </header>
        {msearch && (
          <div className="fixed inset-0 z-50 bg-charcoal-950/60 p-3 lg:hidden" onClick={() => setMsearch(false)}><div onClick={(e) => e.stopPropagation()}><GlobalSearch autoFocus onDone={() => setMsearch(false)} /></div></div>)}

        {/* Desktop header */}
        <header className="concrete no-print sticky top-0 z-20 hidden h-[72px] items-center gap-5 bg-charcoal-900 px-6 lg:flex">
          <div className="relative z-10 shrink-0"><Breadcrumbs /></div>
          <GlobalSearch className="relative z-10 mx-auto w-full max-w-xl" />
          <div className="relative z-10 flex items-center gap-3">
            {onDash && <PeriodPicker />}<Notifications />
            {canRecord && <button className="btn h-11 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.06] px-4 text-white hover:bg-white/10" onClick={() => openRecord('transfer')}><ArrowLeftRight size={15} />Transfer</button>}
            {canRecord && <button className="btn-primary h-11 whitespace-nowrap rounded-md px-5" onClick={() => openRecord('transaction')}><Plus size={16} />Record Transaction</button>}
            <ProfileMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 pb-28 pt-5 sm:px-5 lg:px-8 lg:pb-12 lg:pt-7" key={loc.pathname}><Outlet /></main>

        {/* Mobile bottom tabs */}
        <nav aria-label="Quick" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-end border-t border-slate2-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {tabs.slice(0, 2).map((t) => <Tab key={t.to} {...t} />)}
          <div className="flex justify-center">{canRecord && <button onClick={() => openRecord('transaction')} aria-label="Record Transaction" className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-pop ring-4 ring-white active:bg-brand-600"><Plus size={26} /></button>}</div>
          {tabs.slice(2, 4).map((t) => <Tab key={t.to} {...t} />)}{tabs.length < 3 && <span />}
        </nav>
      </div>
    </div>
  )
}

function Tab({ to, label, icon: Icon }: { to: string; label: string; icon: typeof X }) {
  return <NavLink to={to} end={to === '/'} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-600' : 'text-slate2-500')}><Icon size={20} strokeWidth={1.8} />{label}</NavLink>
}

export default function AppLayout() { return <PeriodProvider><RecordProvider><Shell /></RecordProvider></PeriodProvider> }
