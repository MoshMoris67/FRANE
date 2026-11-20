import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

type Listener = (m: string) => void
const listeners = new Set<Listener>()
export const toast = (m: string) => listeners.forEach((l) => l(m))

export function Toaster() {
  const [items, setItems] = useState<{ id: number; m: string }[]>([])
  useEffect(() => {
    const l: Listener = (m) => {
      const id = Date.now() + Math.random()
      setItems((x) => [...x, { id, m }])
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500)
    }
    listeners.add(l); return () => { listeners.delete(l) }
  }, [])
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 lg:bottom-6" aria-live="polite">
      {items.map((i) => <div key={i.id} className="pointer-events-auto flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl"><CheckCircle2 size={16} className="text-emerald-400" />{i.m}</div>)}
    </div>
  )
}
