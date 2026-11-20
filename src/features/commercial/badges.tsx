import { Badge } from '../../components/ui'
import type { Sale } from '../../lib/types'
import { today } from '../../lib/format'

export function SaleStatusBadges({ sale }: { sale: Pick<Sale, 'status' | 'payment_status' | 'balance' | 'due_date' | 'delivery_status'> }) {
  if (sale.status === 'draft') return <Badge>Draft</Badge>
  if (sale.status === 'cancelled') return <Badge tone="red">Cancelled</Badge>
  const overdue = sale.balance > 0 && !!sale.due_date && sale.due_date < today()
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sale.payment_status === 'paid' ? <Badge tone="green">Paid</Badge> : overdue ? <Badge tone="red">Overdue</Badge>
        : sale.payment_status === 'partially_paid' ? <Badge tone="amber">Partially paid</Badge> : <Badge tone="orange">Credit · unpaid</Badge>}
    </span>
  )
}
export const DELIVERY_LABEL: Record<string, string> = { pending: 'Pending', loading: 'Loading', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' }
export function DeliveryBadge({ status }: { status: string }) {
  const tone = status === 'delivered' ? 'green' : status === 'dispatched' ? 'orange' : status === 'cancelled' ? 'red' : 'neutral'
  return <Badge tone={tone}>{DELIVERY_LABEL[status]}</Badge>
}
