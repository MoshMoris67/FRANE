import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, LogOut, Plus, Menu, X } from 'lucide-react'
import clsx from 'clsx'
import { NAV } from './nav'
import { Brand, LogoMark } from '../Logo'
import { useAuth } from '../../auth/AuthContext'
import { useSettings } from '../../features/data'
import { RecordProvider, useRecord } from './RecordContext'
import { ROLE_LABEL } from '../../lib/types'

function SidebarLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can } = useAuth()
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {NAV.filter((n) => can(n.module, 'view')).map((n) => (
        <NavLink key={n.key} to={n.path} end={n.path === '/'} onClick={onNavigate} title={collapsed ? n.label : undefined}
          className={({ isActive }) => clsx('group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-brand-500 text-white' : 'text-slate2-300 hover:bg-charcoal-700 hover:text-white', collapsed && 'justify-center px-2')}>
          <n.icon size={18} className="shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
          {!collapsed && n.phase > 1 && <span className="rounded bg-charcoal-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate2-400 group-hover:bg-charcoal-800">P{n.phase}</span>}
        </NavLink>
      ))}
    </nav>
  )
}

function UserBlock({ collapsed }: { collapsed?: boolean }) {
  const { session, perms, signOut } = useAuth()
  return (
    <div className="border-t border-charcoal-700 p-3">
      {!collapsed && (
        <div className="mb-2 px-1">
          <p className="truncate text-sm font-medium text-white">{session?.user.email}</p>
          <p className="text-xs text-slate2-400">{perms?.role ? ROLE_LABEL[perms.role] : 'No role assigned'}</p>
        </div>
      )}
      <button onClick={signOut} className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-slate2-300 hover:bg-charcoal-700 hover:text-white', collapsed && 'justify-center')} title="Sign out">
        <LogOut size={16} />{!collapsed && 'Sign out'}
      </button>
    </div>
  )
}

function Shell() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('frane.sidebar') === '1' } catch { return false } })
  const [drawer, setDrawer] = useState(false)
  const { can } = useAuth()
  const { openRecord } = useRecord()
  const { data: settings } = useSettings()
  const loc = useLocation()
  const name = settings?.company.name ?? 'FRANE CONCRETE FACTORY'
  const canRecord = can('transactions', 'create')
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('frane.sidebar', c ? '0' : '1') } catch { /* ignore */ } return !c })

  const tabs = [
    { to: '/', label: 'Home', icon: NAV[0].icon, module: 'dashboard' },
    { to: '/cashbook', label: 'Cashbook', icon: NAV[1].icon, module: 'cashbook' },
    { to: '/transactions', label: 'Txns', icon: NAV[2].icon, module: 'transactions' },
    { to: '/accounts', label: 'Accounts', icon: NAV.find((n) => n.key === 'accounts')!.icon, module: 'accounts' },
  ].filter((t) => can(t.module, 'view'))

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className={clsx('no-print sticky top-0 hidden h-dvh shrink-0 flex-col bg-charcoal-900 transition-all lg:flex', collapsed ? 'w-[68px]' : 'w-64')}>
        <div className={clsx('flex h-16 items-center border-b border-charcoal-700 px-4', collapsed && 'justify-center px-0')}>
          {collapsed ? <LogoMark size={32} /> : <Brand name={name} />}
        </div>
        <SidebarLinks collapsed={collapsed} />
        <button onClick={toggle} className="mx-2 mb-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs text-slate2-400 hover:bg-charcoal-700 hover:text-white" aria-label="Collapse sidebar">
          {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> Collapse</>}
        </button>
        <UserBlock collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-charcoal-950/60" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-charcoal-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 items-center justify-between border-b border-charcoal-700 px-4">
              <Brand name={name} compact />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="text-slate2-300"><X size={20} /></button>
            </div>
            <SidebarLinks onNavigate={() => setDrawer(false)} />
            <UserBlock />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between bg-charcoal-900 px-3 lg:hidden">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded p-2 text-white"><Menu size={22} /></button>
          <Brand name={name} compact />
          <span className="w-9" />
        </header>

        {/* Desktop top bar */}
        <header className="no-print sticky top-0 z-20 hidden h-16 items-center justify-end gap-3 border-b border-slate2-200 bg-white/90 px-6 backdrop-blur lg:flex">
          {canRecord && (
            <>
              <button className="btn-ghost" onClick={() => openRecord('transfer')}>Transfer funds</button>
              <button className="btn-primary" onClick={() => openRecord('transaction')}><Plus size={16} /> Record Transaction</button>
            </>
          )}
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 pb-28 pt-4 sm:px-5 lg:px-6 lg:pb-10 lg:pt-6" key={loc.pathname}>
          <Outlet />
        </main>

        {/* Mobile bottom tabs */}
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-end border-t border-slate2-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {tabs.slice(0, 2).map((t) => <Tab key={t.to} {...t} />)}
          <div className="flex justify-center">
            {canRecord && (
              <button onClick={() => openRecord('transaction')} aria-label="Record Transaction" className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg ring-4 ring-white active:bg-brand-600"><Plus size={26} /></button>
            )}
          </div>
          {tabs.slice(2, 4).map((t) => <Tab key={t.to} {...t} />)}
          {tabs.length < 3 && <span />}
        </nav>
      </div>
    </div>
  )
}

function Tab({ to, label, icon: Icon }: { to: string; label: string; icon: typeof X }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-600' : 'text-slate2-500')}>
      <Icon size={20} />{label}
    </NavLink>
  )
}

export default function AppLayout() {
  return <RecordProvider><Shell /></RecordProvider>
}
