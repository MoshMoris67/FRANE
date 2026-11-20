import type React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthContext'
import AppLayout from './components/layout/AppLayout'
import { NAV } from './components/layout/nav'
import { Spinner } from './components/ui'
import { Toaster } from './components/toast'
import Login from './pages/Login'
import NoAccess from './pages/NoAccess'
import Dashboard from './pages/Dashboard'
import Cashbook from './pages/Cashbook'
import Transactions from './pages/Transactions'
import Accounts from './pages/Accounts'
import Settings from './pages/Settings'
import ComingSoon from './pages/ComingSoon'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } })
const BUILT: Record<string, React.ReactElement> = { dashboard: <Dashboard />, cashbook: <Cashbook />, transactions: <Transactions />, accounts: <Accounts />, settings: <Settings /> }

function Gate() {
  const { session, loading, perms, can } = useAuth()
  if (loading) return <div className="min-h-dvh bg-charcoal-900"><Spinner /></div>
  if (!session) return <Login />
  if (!perms?.role || !perms.active) return <NoAccess />
  const first = NAV.find((n) => can(n.module, 'view') && n.phase === 1)
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {NAV.map((n) => <Route key={n.key} path={n.path} element={can(n.module, 'view') ? (BUILT[n.key] ?? <ComingSoon />) : <Navigate to={first?.path ?? '/'} replace />} />)}
        <Route path="*" element={<Navigate to={first?.path ?? '/'} replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return <QueryClientProvider client={qc}><AuthProvider><BrowserRouter><Gate /><Toaster /></BrowserRouter></AuthProvider></QueryClientProvider>
}
