import { LayoutDashboard, BookOpen, ArrowLeftRight, ShoppingCart, Users, Boxes, Factory, Receipt, Truck, HandCoins, PiggyBank, BarChart3, Landmark, CalendarCheck, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem { key: string; label: string; path: string; icon: LucideIcon; module: string; }

export const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard, module: 'dashboard' },
  { key: 'cashbook', label: 'Cashbook', path: '/cashbook', icon: BookOpen, module: 'cashbook' },
  { key: 'transactions', label: 'Transactions', path: '/transactions', icon: ArrowLeftRight, module: 'transactions' },
  { key: 'sales', label: 'Sales', path: '/sales', icon: ShoppingCart, module: 'sales' },
  { key: 'customers', label: 'Customers', path: '/customers', icon: Users, module: 'customers' },
  { key: 'inventory', label: 'Inventory & Products', path: '/inventory', icon: Boxes, module: 'inventory' },
  { key: 'production', label: 'Production', path: '/production', icon: Factory, module: 'production' },
  { key: 'expenses', label: 'Expenses', path: '/expenses', icon: Receipt, module: 'expenses' },
  { key: 'suppliers', label: 'Suppliers', path: '/suppliers', icon: Truck, module: 'suppliers' },
  { key: 'debts', label: 'Debts & Payments', path: '/debts', icon: HandCoins, module: 'debts' },
  { key: 'budgets', label: 'Budgets', path: '/budgets', icon: PiggyBank, module: 'budgets' },
  { key: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, module: 'reports' },
  { key: 'accounts', label: 'Accounts', path: '/accounts', icon: Landmark, module: 'accounts' },
  { key: 'daily_closing', label: 'Daily Closing', path: '/daily-closing', icon: CalendarCheck, module: 'daily_closing' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: Settings, module: 'settings' },
]
