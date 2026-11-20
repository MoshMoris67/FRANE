import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { PageHeader, Notice } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import PnLView from '../features/reports/PnLView'
import ForecastView from '../features/reports/ForecastView'
import ReportLibrary from '../features/reports/ReportLibrary'

export default function Reports() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams()
  const fin = can('dashboard', 'view') && can('reports', 'view')
  const tabs = [...(fin ? [['pnl', 'Profit & Loss'], ['forecast', 'Cash-flow forecast']] : []), ['library', 'Report library']] as [string, string][]
  const tab = tabs.find(([k]) => k === sp.get('tab'))?.[0] ?? tabs[0][0]
  return (
    <>
      <PageHeader title="Reports" subtitle="Statements, analysis and exports — every figure ties back to the ledger" />
      {!can('reports', 'view') && <Notice tone="amber">You do not have access to reports.</Notice>}
      <div className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-slate2-200 px-1">{tabs.map(([k, l]) => <button key={k} onClick={() => setSp({ tab: k }, { replace: true })} className={clsx('-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold', tab === k ? 'border-brand-500' : 'border-transparent text-slate2-500 hover:text-charcoal-900')}>{l}</button>)}</div>
      {tab === 'pnl' && <PnLView />}{tab === 'forecast' && <ForecastView />}{tab === 'library' && <ReportLibrary />}
    </>
  )
}
