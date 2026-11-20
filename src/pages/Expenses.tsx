import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { PageHeader } from '../components/ui'
import ExpensesTab from '../features/expenses/ExpensesTab'
import PayrollTab from '../features/expenses/PayrollTab'
import { useAuth } from '../auth/AuthContext'

export default function Expenses() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'payroll' && can('payroll', 'view') ? 'payroll' : 'expenses'
  return (
    <>
      <PageHeader title="Expenses" subtitle="What the factory spends — incurred, paid and still owing" />
      {can('payroll', 'view') && <div className="mb-4 flex gap-1 border-b border-slate2-200">{([['expenses', 'Expenses'], ['payroll', 'Payroll & labour']] as const).map(([k, l]) => <button key={k} onClick={() => setSp(k === 'payroll' ? { tab: 'payroll' } : {}, { replace: true })} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold', tab === k ? 'border-brand-500' : 'border-transparent text-slate2-500')}>{l}</button>)}</div>}
      {tab === 'expenses' ? <ExpensesTab /> : <PayrollTab />}
    </>
  )
}
