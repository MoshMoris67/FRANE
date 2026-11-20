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
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import Sales from './pages/Sales'
import SaleForm from './pages/SaleForm'
import SaleDetail from './pages/SaleDetail'
import Debts from './pages/Debts'
import Suppliers from './pages/Suppliers'
import SupplierDetail from './pages/SupplierDetail'
import Inventory from './pages/Inventory'
import Production from './pages/Production'
import BatchDetail from './pages/BatchDetail'
import Document from './pages/Document'
import Expenses from './pages/Expenses'
import Budgets from './pages/Budgets'
import DailyClosing from './pages/DailyClosing'
import Reports from './pages/Reports'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } })
const BUILT: Record<string, React.ReactElement> = { dashboard: <Dashboard />, cashbook: <Cashbook />, transactions: <Transactions />, accounts: <Accounts />, settings: <Settings />, sales: <Sales />, customers: <Customers />, debts: <Debts />, suppliers: <Suppliers />, inventory: <Inventory />, production: <Production />, expenses: <Expenses />, budgets: <Budgets />, daily_closing: <DailyClosing />, reports: <Reports /> }

function Gate() {
  const { session, loading, perms, can } = useAuth()
  if (loading) return <div className="min-h-dvh bg-charcoal-900"><Spinner /></div>
  if (!session) return <Login />
  if (!perms?.role || !perms.active) return <NoAccess />
  const first = NAV.find((n) => can(n.module, 'view') && n.phase === 1)
  const guard = (module: string, el: React.ReactElement, action: 'view' | 'create' = 'view') => (can(module, action) ? el : <Navigate to={first?.path ?? '/'} replace />)
  return (
    <Routes>
      <Route path="/documents/:kind/:id" element={<Document />} />
      <Route element={<AppLayout />}>
        <Route path="/customers/:id" element={guard('customers', <CustomerDetail />)} />
        <Route path="/suppliers/:id" element={guard('suppliers', <SupplierDetail />)} />
        <Route path="/production/:id" element={guard('production', <BatchDetail />)} />
        <Route path="/sales/new" element={guard('sales', <SaleForm />, 'create')} />
        <Route path="/sales/:id/edit" element={guard('sales', <SaleForm />, 'create')} />
        <Route path="/sales/:id" element={guard('sales', <SaleDetail />)} />
        {NAV.map((n) => <Route key={n.key} path={n.path} element={can(n.module, 'view') ? (BUILT[n.key] ?? <ComingSoon />) : <Navigate to={first?.path ?? '/'} replace />} />)}
        <Route path="*" element={<Navigate to={first?.path ?? '/'} replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return <QueryClientProvider client={qc}><AuthProvider><BrowserRouter><Gate /><Toaster /></BrowserRouter></AuthProvider></QueryClientProvider>
}
