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

// thin dividers between related groups of modules
const GROUP_STARTS = new Set(['sales', 'inventory', 'expenses', 'reports', 'settings'])

function SidebarLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can } = useAuth()
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 py-3">
      {NAV.filter((n) => can(n.module, 'view')).map((n) => (
        <div key={n.key} className={clsx(GROUP_STARTS.has(n.key) && 'mt-2.5 border-t border-white/[0.07] pt-2.5')}>
          <NavLink to={n.path} end={n.path === '/'} onClick={onNavigate} title={collapsed ? n.label : undefined}
            className={({ isActive }) => clsx('group relative flex items-center gap-3 rounded-sm py-[7px] pl-3 pr-2.5 text-[13.5px] transition-colors', collapsed && 'justify-center px-0',
              isActive ? 'bg-white/[0.07] font-medium text-white' : 'text-slate2-300 hover:bg-white/[0.04] hover:text-white')}>
            {({ isActive }) => (<>
              {isActive && <span className="absolute inset-y-1 left-0 w-[2px] bg-brand-400" />}
              <n.icon size={17} strokeWidth={1.8} className={clsx('shrink-0', isActive ? 'text-brand-400' : 'text-slate2-400 group-hover:text-slate2-200')} />
              {!collapsed && <span className="flex-1 truncate">{n.label}</span>}</>)}
          </NavLink>
        </div>))}
    </nav>
  )
}

function UserBlock({ collapsed }: { collapsed?: boolean }) {
  const { session, perms, signOut } = useAuth(); const email = session?.user.email ?? ''
  return (
    <div className={clsx('flex items-center gap-2.5 border-t border-white/[0.07] p-3', collapsed && 'justify-center')}>
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
      <aside className={clsx('concrete no-print sticky top-0 hidden h-dvh shrink-0 flex-col bg-charcoal-900 transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-[248px]')}>
        <div className={clsx('flex h-16 items-center border-b border-white/[0.07]', collapsed ? 'justify-center' : 'px-5')}>{collapsed ? <LogoMark size={30} url={logo} /> : <Brand name={name} logoUrl={logo} />}</div>
        <SidebarLinks collapsed={collapsed} />
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
        <header className="no-print sticky top-0 z-20 hidden h-14 items-center gap-4 border-b border-slate2-200 bg-slate2-50/90 px-6 backdrop-blur lg:flex">
          <Breadcrumbs />
          <GlobalSearch className="mx-auto w-full max-w-md" />
          <div className="flex items-center gap-2">
            {onDash && <PeriodPicker />}<Notifications />
            {canRecord && <button className="btn-ghost !h-9 !py-0 whitespace-nowrap" onClick={() => openRecord('transfer')}><ArrowLeftRight size={15} />Transfer</button>}
            {canRecord && <button className="btn-primary !h-9 !py-0 whitespace-nowrap" onClick={() => openRecord('transaction')}><Plus size={16} />Record Transaction</button>}
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
