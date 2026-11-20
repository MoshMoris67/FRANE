import { useLocation } from 'react-router-dom'
import { Hammer } from 'lucide-react'
import { NAV } from '../components/layout/nav'
import { PageHeader, Empty } from '../components/ui'

export default function ComingSoon() {
  const { pathname } = useLocation()
  const item = NAV.find((n) => n.path === pathname)
  if (!item) return <Empty title="Page not found" />
  return (
    <>
      <PageHeader title={item.label} subtitle={`Scheduled for Phase ${item.phase}`} />
      <div className="card"><Empty icon={<Hammer size={22} />} title={`${item.label} is built in Phase ${item.phase}`}>
        {item.summary} Phase 1 (accounts, transactions, cashbook, dashboard) is the foundation these modules post into, so nothing is duplicated when they arrive.
      </Empty></div>
    </>
  )
}
