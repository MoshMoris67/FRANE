import { LayoutDashboard, BookOpen, ArrowLeftRight, ShoppingCart, Users, Boxes, Factory, Receipt, Truck, HandCoins, PiggyBank, BarChart3, Landmark, CalendarCheck, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem { key: string; label: string; path: string; icon: LucideIcon; module: string; phase: number; built?: boolean; summary?: string }

export const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard, module: 'dashboard', phase: 1, built: true },
  { key: 'cashbook', label: 'Cashbook', path: '/cashbook', icon: BookOpen, module: 'cashbook', phase: 1, built: true },
  { key: 'transactions', label: 'Transactions', path: '/transactions', icon: ArrowLeftRight, module: 'transactions', phase: 1, built: true },
  { key: 'sales', label: 'Sales', path: '/sales', icon: ShoppingCart, module: 'sales', phase: 2, built: true, summary: 'Multi-product invoices, delivery tracking, receipts, and automatic customer balances.' },
  { key: 'customers', label: 'Customers', path: '/customers', icon: Users, module: 'customers', phase: 2, built: true, summary: 'Customer database with purchase history, payments, statements and outstanding debt.' },
  { key: 'inventory', label: 'Inventory & Products', path: '/inventory', icon: Boxes, module: 'inventory', phase: 3, built: true, summary: '' },
  { key: 'production', label: 'Production', path: '/production', icon: Factory, module: 'production', phase: 3, built: true, summary: 'Production batches, material consumption, labour and cost-per-unit.' },
  { key: 'expenses', label: 'Expenses', path: '/expenses', icon: Receipt, module: 'expenses', phase: 4, summary: 'Incurred vs paid expenses, approvals, receipts, and payroll/labour.' },
  { key: 'suppliers', label: 'Suppliers', path: '/suppliers', icon: Truck, module: 'suppliers', phase: 2, built: true, summary: 'Supplier database, purchase invoices, payables and payment allocation.' },
  { key: 'debts', label: 'Debts & Payments', path: '/debts', icon: HandCoins, module: 'debts', phase: 2, built: true, summary: 'Receivables and payables with aging, partial payments and allocation.' },
  { key: 'budgets', label: 'Budgets', path: '/budgets', icon: PiggyBank, module: 'budgets', phase: 4, summary: 'Monthly/quarterly/yearly budgets with variance and over-budget alerts.' },
  { key: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, module: 'reports', phase: 5, summary: 'Profit & Loss, cash-flow forecasting, sales, inventory, production and debt reports.' },
  { key: 'accounts', label: 'Accounts', path: '/accounts', icon: Landmark, module: 'accounts', phase: 1, built: true },
  { key: 'daily_closing', label: 'Daily Closing', path: '/daily-closing', icon: CalendarCheck, module: 'daily_closing', phase: 4, summary: 'End-of-day cash count, variance explanation, approval and reconciliation.' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: Settings, module: 'settings', phase: 1, built: true },
]
