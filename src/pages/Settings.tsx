import { useState } from 'react'
import clsx from 'clsx'
import { PageHeader } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import CompanyTab from '../features/settings/CompanyTab'
import CategoriesTab from '../features/settings/CategoriesTab'
import UsersTab from '../features/settings/UsersTab'
import AuditTab from '../features/settings/AuditTab'
import DataTab from '../features/settings/DataTab'
import ControlsTab from '../features/settings/ControlsTab'

export default function Settings() {
  const { can } = useAuth()
  const tabs = [
    { id: 'company', label: 'Company', show: true },
    { id: 'categories', label: 'Categories', show: true },
    { id: 'controls', label: 'Controls & approvals', show: true },
    { id: 'users', label: 'Users & permissions', show: can('users', 'view') },
    { id: 'audit', label: 'Audit log', show: can('audit', 'view') },
    { id: 'data', label: 'Backup & demo data', show: can('settings', 'edit') },
  ].filter((t) => t.show)
  const [tab, setTab] = useState('company')
  return (
    <>
      <PageHeader title="Settings" subtitle="Company details, categories, access control and audit trail" />
      <div className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-slate2-200 px-1">
        {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={clsx('-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold', tab === t.id ? 'border-brand-500 text-charcoal-900' : 'border-transparent text-slate2-500 hover:text-charcoal-900')}>{t.label}</button>)}
      </div>
      {tab === 'company' && <CompanyTab />}{tab === 'categories' && <CategoriesTab />}{tab === 'controls' && <ControlsTab />}{tab === 'users' && <UsersTab />}{tab === 'audit' && <AuditTab />}{tab === 'data' && <DataTab />}
    </>
  )
}
